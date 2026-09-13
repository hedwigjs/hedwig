import type { ClientID, Message } from '../types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';
import type { HookResult } from '../hooks/HooksRegistry.types';
import type { Transport, TransportFrameMeta } from '../transport/Transport.types';
import type {
  RemoteClient,
  RemoteClientOptions,
  RemoteFrameRejectReason,
  RemoteIdentity,
} from './RemoteClient.types';
import { matchesAnyPattern } from '../utils/matchPattern';
import { RoutingResult, RoutingReason } from '../routing/RoutingResult';
import { parseFrame, buildFrame, buildResponse, toWireReason } from '../wire/envelope';
import type { WireExt, WireResponse, ParsedWireMessage } from '../wire/envelope';

/**
 * What a remote client needs from the core. Injected as callbacks so the
 * class never holds a reference to `BrokerCore`.
 * @internal
 */
export interface RemoteHost {
  logger: BrokerLogger;
  /** This realm's session id: stamped on outbound frames, echo-guarded on inbound. */
  origin: string;
  /** Run the pipeline for an inbound frame with `fromExternal`, `via`, `wireId`, `ext` set. */
  inject(
    remoteId: string,
    topic: string,
    source: ClientID,
    target: string,
    data: unknown,
    wire: { wireId?: string; ext?: WireExt },
    options?: { timeout?: number },
  ): Promise<RoutingResult>;
  /** Policy check for `forward()`. */
  onSubscribe(topic: string, clientId: ClientID): HookResult;
  subscriptionAdded(clientId: ClientID, topic: string): void;
  subscriptionRemoved(clientId: ClientID, topic: string): void;
  subscriptionRejected(clientId: ClientID, topic: string, reason: string): void;
  frameRejected(
    remoteId: string,
    reason: RemoteFrameRejectReason,
    claimed: { source?: string; topic?: string },
  ): void;
  sendFailed(remoteId: string, topic: string, messageId: string, reason: string, error?: unknown): void;
  /** Called once from `destroy()` so the core can unregister the remote. */
  destroyed(remoteId: string): void;
  /** Fresh local id for a frame this runtime produces on its own (responses). */
  nextId(): string;
  requestForwarded(payload: { remoteId: string; topic: string; messageId: string; correlationId: string; deadline?: number }): void;
  responseReceived(payload: { remoteId: string; topic: string; correlationId: string; status: 'ACK' | 'NACK'; reason: string; latencyMs: number }): void;
  requestTimeout(payload: { remoteId: string; topic: string; correlationId: string; timeout: number }): void;
  responseSent(payload: { remoteId: string; topic: string; correlationId: string; status: 'ACK' | 'NACK'; reason: string }): void;
}

interface PendingRequest {
  topic: string;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (result: RoutingResult) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/**
 * Runtime implementation of {@link RemoteClient}. Created by
 * `BrokerCore.createRemoteClient`; never constructed by user code.
 * @internal
 */

/** Size of an inbound frame for `maxBytes`: what the transport measured, else the JSON text length. */
function frameSize(raw: unknown, meta?: TransportFrameMeta): number {
  if (meta?.bytes !== undefined) return meta.bytes;
  if (typeof raw === 'string') return raw.length;
  try {
    return JSON.stringify(raw)?.length ?? 0;
  } catch {
    return 0; // not JSON-encodable: the structural check rejects it as MALFORMED
  }
}

export class RemoteClientImpl implements RemoteClient {
  readonly id: string;
  readonly kind: string;
  readonly identity: RemoteIdentity['mode'];
  readonly duplex: boolean;
  readonly fanout: boolean;
  readonly requests: boolean;
  readonly ready: Promise<void>;
  readonly createdAt = Date.now();

  #identity: RemoteIdentity;
  #accepts: string[];
  #forward: string[] = [];
  #transport: Transport;
  #host: RemoteHost;
  #unsubscribe: (() => void) | null;
  #offClose: (() => void) | null = null;
  #maxBytes: number | undefined;
  #rate: { max: number; window: number; stamps: number[] } | undefined;
  #readyState: 'pending' | 'ready' | 'failed' = 'pending';
  #destroyed = false;
  #pending = new Map<string, PendingRequest>();
  #timeout: number | undefined;

  constructor(id: string, kind: string, transport: Transport, options: RemoteClientOptions, host: RemoteHost) {
    this.id = id;
    this.kind = kind;
    this.#transport = transport;
    this.#host = host;
    this.#identity = options.identity ?? { mode: 'fixed' };
    this.identity = this.#identity.mode;
    this.#accepts = [...(options.accepts ?? [])];
    this.duplex = transport.duplex !== false;
    this.fanout = transport.fanout === true;
    this.requests = this.duplex && !this.fanout;
    this.#maxBytes = options.maxBytes;
    this.#rate = options.rateLimit ? { ...options.rateLimit, stamps: [] } : undefined;
    this.#timeout = options.timeout;

    this.ready = (transport.ready ?? Promise.resolve()).then(
      () => {
        this.#readyState = 'ready';
      },
      (error: unknown) => {
        this.#readyState = 'failed';
        throw error;
      },
    );
    // Observed lazily by send(); don't let it surface as unhandled here.
    this.ready.catch(() => {});

    this.#unsubscribe = transport.onMessage((raw, meta) => this.#handleIncoming(raw, meta));
    this.#offClose = transport.onClose?.(() => this.destroy()) ?? null;
  }

  get forwardPatterns(): ReadonlyArray<string> {
    return this.#forward;
  }

  /** Requests in flight to this remote. */
  get pending(): number {
    return this.#pending.size;
  }

  get acceptPatterns(): ReadonlyArray<string> {
    return this.#accepts;
  }

  // ── subscriptions ──────────────────────────────────────────────────────

  forward(pattern: string | string[]): () => void {
    this.#assertAlive();
    const patterns = Array.isArray(pattern) ? [...pattern] : [pattern];
    for (const p of patterns) {
      const verdict = this.#host.onSubscribe(p, this.id);
      if (!verdict.allowed) {
        this.#host.subscriptionRejected(this.id, p, verdict.message);
        throw new Error(verdict.message);
      }
    }
    for (const p of patterns) {
      this.#forward.push(p);
      this.#host.subscriptionAdded(this.id, p);
    }
    return () => {
      for (const p of patterns) {
        const i = this.#forward.indexOf(p);
        if (i !== -1) {
          this.#forward.splice(i, 1);
          this.#host.subscriptionRemoved(this.id, p);
        }
      }
    };
  }

  accept(pattern: string | string[]): () => void {
    this.#assertAlive();
    const patterns = Array.isArray(pattern) ? [...pattern] : [pattern];
    this.#accepts.push(...patterns);
    return () => {
      for (const p of patterns) {
        const i = this.#accepts.indexOf(p);
        if (i !== -1) this.#accepts.splice(i, 1);
      }
    };
  }

  /** @internal Whether a local multicast on `topic` should be sent to this remote. */
  matchesForward(topic: string): boolean {
    return this.#forward.length > 0 && matchesAnyPattern(topic, this.#forward);
  }

  // ── outbound ───────────────────────────────────────────────────────────

  /**
   * Send a local message to the remote as a v1 wire frame (see
   * `wire/envelope.ts`): local-only flags never go on the wire, `origin`
   * is this realm's session id. Waits for the transport's `ready`; a send
   * that still fails is reported as `remote.send.failed`, never thrown
   * into the emitter's pipeline.
   * @internal
   */
  send(message: Message): void {
    if (this.#destroyed) return;
    this.#deliver(buildFrame(message, this.#host.origin), message.topic, message.id, (reason, error) => {
      this.#host.sendFailed(this.id, message.topic, message.id, reason, error);
    });
  }

  /**
   * Hand a frame to the transport once it is ready. Failure is reported to
   * `onFailure` with `TRANSPORT_THREW` / `NOT_OPEN`; nothing is thrown.
   */
  #deliver(frame: unknown, _topic: string, _messageId: string, onFailure: (reason: 'TRANSPORT_THREW' | 'NOT_OPEN', error?: unknown) => void): void {
    const attempt = () => {
      if (this.#destroyed) return;
      try {
        this.#transport.send(frame);
      } catch (error) {
        onFailure('TRANSPORT_THREW', error);
      }
    };
    if (this.#readyState === 'ready') {
      attempt();
      return;
    }
    if (this.#readyState === 'failed') {
      onFailure('NOT_OPEN');
      return;
    }
    this.ready.then(attempt, (error: unknown) => {
      onFailure('NOT_OPEN', error);
    });
  }

  // ── requests to the remote ─────────────────────────────────────────────

  /**
   * Send a local unicast to the remote as a `kind: 'request'` frame and
   * wait for the matching `kind: 'response'` over this transport.
   *
   * Resolves — never rejects — with the far side's result, `NACK TIMEOUT`
   * when nothing came back in time (the far side may still run it; retry
   * is the caller's decision, keyed by the message id), `NACK REMOTE_GONE`
   * when the remote is destroyed or the transport could not carry the
   * frame, `NACK TRANSPORT_ONE_WAY` / `NACK TRANSPORT_FANOUT` immediately
   * for transports that cannot answer. `NACK BROKER_DESTROYED` when the
   * broker went down while the request was pending.
   * @internal
   */
  request(message: Message, timeout: number | undefined): Promise<RoutingResult> {
    if (!this.duplex) {
      return Promise.resolve(
        RoutingResult.create('NACK', RoutingReason.TRANSPORT_ONE_WAY, `Remote '${this.id}' is inbound-only (${this.kind}); it cannot answer a request`, this.id),
      );
    }
    if (this.fanout) {
      return Promise.resolve(
        RoutingResult.create('NACK', RoutingReason.TRANSPORT_FANOUT, `Remote '${this.id}' is a fan-out transport (${this.kind}); a request has no single responder`, this.id),
      );
    }
    if (this.#destroyed) {
      return Promise.resolve(RoutingResult.create('NACK', RoutingReason.REMOTE_GONE, `Remote '${this.id}' has been destroyed`, this.id));
    }

    const effectiveTimeout = timeout ?? this.#timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const correlationId = message.id;
    const deadline = Date.now() + effectiveTimeout;

    return new Promise<RoutingResult>((resolve) => {
      const entry: PendingRequest = {
        topic: message.topic,
        startedAt: Date.now(),
        timer: setTimeout(() => {
          if (this.#pending.delete(correlationId)) {
            this.#host.requestTimeout({ remoteId: this.id, topic: message.topic, correlationId, timeout: effectiveTimeout });
            resolve(
              RoutingResult.create('NACK', RoutingReason.TIMEOUT, `Request to remote '${this.id}' timed out after ${effectiveTimeout} ms`, this.id),
            );
          }
        }, effectiveTimeout),
        resolve,
      };
      this.#pending.set(correlationId, entry);

      const frame = buildFrame(message, this.#host.origin, { correlationId, deadline });
      this.#deliver(frame, message.topic, message.id, (reason, error) => {
        // The frame never left: settle now instead of waiting for the timeout.
        if (this.#settle(correlationId)) {
          this.#host.sendFailed(this.id, message.topic, message.id, reason, error);
          resolve(
            RoutingResult.create('NACK', RoutingReason.REMOTE_GONE, `Remote '${this.id}' could not be reached (${reason})`, this.id),
          );
        }
      });
      this.#host.requestForwarded({ remoteId: this.id, topic: message.topic, messageId: message.id, correlationId, deadline });
    });
  }

  /** Remove a pending entry and clear its timer; `undefined` when unknown. */
  #settle(correlationId: string): PendingRequest | undefined {
    const entry = this.#pending.get(correlationId);
    if (!entry) return undefined;
    this.#pending.delete(correlationId);
    if (entry.timer) clearTimeout(entry.timer);
    return entry;
  }

  #failPending(reason: 'REMOTE_GONE' | 'BROKER_DESTROYED', message: string): void {
    for (const [correlationId, entry] of Array.from(this.#pending)) {
      this.#pending.delete(correlationId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(RoutingResult.create('NACK', RoutingReason[reason], message, this.id));
    }
  }

  #handleResponse(frame: WireResponse): void {
    const entry = this.#settle(frame.correlationId);
    // A response nobody waits for (late, duplicated, or for another realm)
    // is ignored — matching is by correlationId over this transport only.
    if (!entry) return;
    const latencyMs = Date.now() - entry.startedAt;
    this.#host.responseReceived({
      remoteId: this.id,
      topic: frame.topic,
      correlationId: frame.correlationId,
      status: frame.status,
      reason: frame.reason,
      latencyMs,
    });
    entry.resolve(
      RoutingResult.create(frame.status, frame.reason, frame.message ?? `Remote '${this.id}' answered ${frame.status} ${frame.reason}`, this.id, frame.data),
    );
  }

  /**
   * A request that arrived over the wire targets a local client. Route it
   * as a unicast, then answer over the same transport — every outcome,
   * including a hook denial, becomes a response so the peer never waits
   * for its own timeout unnecessarily. A frame with neither `id` nor
   * `correlationId` cannot be answered; it is still routed.
   */
  async #handleRequest(frame: ParsedWireMessage, source: string, ext: WireExt | undefined): Promise<void> {
    // The sender's deadline bounds how long the local handler may run.
    // Measured as a duration in the sender's own clock (deadline − the
    // frame's timestamp), so a clock offset between the two sides does not
    // turn every request into an instant timeout.
    const budget =
      frame.deadline !== undefined && frame.timestamp !== undefined ? frame.deadline - frame.timestamp : undefined;
    const correlationId = frame.correlationId ?? frame.id;

    let result: RoutingResult;
    if (budget !== undefined && budget <= 0) {
      result = RoutingResult.create('NACK', RoutingReason.TIMEOUT, 'Request deadline had already passed on arrival');
    } else {
      result = await this.#host.inject(
        this.id,
        frame.topic,
        source,
        frame.target,
        frame.data,
        { wireId: frame.id, ext },
        budget !== undefined ? { timeout: budget } : undefined,
      );
    }
    if (correlationId === undefined || this.#destroyed) return;

    let status = result.status;
    let { reason, exact } = toWireReason(result.reason);
    let message: string | undefined = result.message;
    let data: unknown = result.data;
    let details: unknown = exact ? undefined : { reason: result.reason };
    if (status === 'ACK' && data !== undefined && !isEncodable(data)) {
      status = 'NACK';
      reason = 'SERIALIZATION_FAILED';
      message = `Handler result for '${frame.topic}' cannot be encoded for the wire`;
      data = undefined;
    }
    const response = buildResponse({
      id: this.#host.nextId(),
      origin: this.#host.origin,
      correlationId,
      topic: frame.topic,
      source: frame.target,
      target: frame.source ?? this.id,
      status,
      reason,
      message,
      data,
      details,
    });
    this.#deliver(response, frame.topic, response.id as string, (sendReason, error) => {
      this.#host.sendFailed(this.id, frame.topic, response.id as string, sendReason, error);
    });
    this.#host.responseSent({ remoteId: this.id, topic: frame.topic, correlationId, status, reason });
  }

  // ── inbound ────────────────────────────────────────────────────────────

  #handleIncoming(raw: unknown, meta?: TransportFrameMeta): void {
    if (this.#destroyed) return;

    // `maxBytes` applies to every transport: text transports report the
    // wire length, structured-clone ones (postMessage, BroadcastChannel,
    // MessagePort) are measured as JSON text here — only when the limit is
    // configured, so nobody pays for it otherwise.
    if (this.#maxBytes !== undefined && frameSize(raw, meta) > this.#maxBytes) {
      this.#host.frameRejected(this.id, 'TOO_LARGE', {});
      return;
    }
    if (this.#rate && !this.#admit(this.#rate)) {
      this.#host.frameRejected(this.id, 'RATE_LIMITED', {});
      return;
    }

    // Structural check + v/kind support, equivalent to the JSON Schema.
    const parsed = parseFrame(raw);
    if (!parsed.ok) {
      this.#host.frameRejected(this.id, parsed.reason, this.#claimed(raw));
      return;
    }
    const frame = parsed.frame;
    const claimed = { source: frame.source, topic: frame.topic };

    // Echo guard: a frame stamped with our own session id came back to us
    // (a loopback transport, a relay that mirrors what it receives).
    if (frame.origin !== undefined && frame.origin === this.#host.origin) {
      this.#host.frameRejected(this.id, 'ECHO', claimed);
      return;
    }

    // Responses bypass `accepts` and identity: they are matched to a
    // pending request by correlationId, over this transport only.
    if (frame.kind === 'response') {
      this.#handleResponse(frame);
      return;
    }

    if (!matchesAnyPattern(frame.topic, this.#accepts)) {
      this.#host.frameRejected(this.id, 'TOPIC_NOT_ACCEPTED', claimed);
      return;
    }

    const source = this.#resolveSource(frame.source);
    if (!source.ok) {
      this.#host.frameRejected(this.id, source.reason, claimed);
      return;
    }

    // `ext.hedwig.claimedSource`: what a fixed-identity peer said it was,
    // when that was consistent with its identity (a different claim is a
    // rejection above). Runtime-owned key; the rest of `ext` is opaque.
    let ext = frame.ext;
    if (this.#identity.mode === 'fixed' && frame.source !== undefined) {
      ext = { ...ext, hedwig: { ...(ext?.hedwig ?? {}), claimedSource: frame.source } };
    }

    if (frame.kind === 'request') {
      void this.#handleRequest(frame, source.value, ext);
      return;
    }
    void this.#host.inject(this.id, frame.topic, source.value, frame.target, frame.data, {
      wireId: frame.id,
      ext,
    });
  }

  #resolveSource(claimed: string | undefined): { ok: true; value: string } | { ok: false; reason: RemoteFrameRejectReason } {
    const identity = this.#identity;
    switch (identity.mode) {
      case 'fixed':
        if (claimed === undefined || claimed === this.id) return { ok: true, value: this.id };
        return { ok: false, reason: 'SOURCE_MISMATCH' };
      case 'allow':
        if (claimed !== undefined && identity.sources.includes(claimed)) return { ok: true, value: claimed };
        return { ok: false, reason: 'SOURCE_NOT_ALLOWED' };
      case 'prefix': {
        if (claimed === undefined) return { ok: false, reason: 'MALFORMED' };
        return { ok: true, value: `${identity.prefix ?? this.id}:${claimed}` };
      }
    }
  }

  #claimed(raw: unknown): { source?: string; topic?: string } {
    if (!raw || typeof raw !== 'object') return {};
    const r = raw as Record<string, unknown>;
    return {
      source: typeof r.source === 'string' ? r.source : undefined,
      topic: typeof r.topic === 'string' ? r.topic : undefined,
    };
  }

  #admit(rate: { max: number; window: number; stamps: number[] }): boolean {
    const now = Date.now();
    while (rate.stamps.length > 0 && now - rate.stamps[0]! >= rate.window) rate.stamps.shift();
    if (rate.stamps.length >= rate.max) return false;
    rate.stamps.push(now);
    return true;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  destroy(): void {
    this.dispose('REMOTE_GONE');
  }

  /**
   * Tear down with a specific verdict for pending requests: `REMOTE_GONE`
   * (the remote went away) or `BROKER_DESTROYED` (the whole broker did).
   * @internal
   */
  dispose(pendingReason: 'REMOTE_GONE' | 'BROKER_DESTROYED'): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#failPending(
      pendingReason,
      pendingReason === 'REMOTE_GONE' ? `Remote '${this.id}' was destroyed while the request was pending` : 'Broker is destroyed',
    );
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#offClose?.();
    this.#offClose = null;
    try {
      this.#transport.destroy();
    } catch (error) {
      this.#host.logger.error('remote.transport.destroy_failed', { remoteId: this.id, error });
    }
    for (const p of this.#forward.splice(0)) {
      this.#host.subscriptionRemoved(this.id, p);
    }
    this.#host.destroyed(this.id);
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  #assertAlive(): void {
    if (this.#destroyed) {
      throw new Error(`@hedwigjs/broker: remote client '${this.id}' has been destroyed`);
    }
  }
}

/** JSON-encodable check for a handler's return value before it goes on the wire. */
function isEncodable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}
