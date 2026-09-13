import type { ClientID, Message } from '../types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';
import type { HookResult } from '../hooks/HooksRegistry.types';
import type { RoutingResult } from '../routing/RoutingResult';
import type { Transport } from '../transport/Transport.types';
import type {
  RemoteClient,
  RemoteClientOptions,
  RemoteFrameRejectReason,
  RemoteIdentity,
} from './RemoteClient.types';
import { matchesAnyPattern } from '../utils/matchPattern';
import { parseFrame, buildFrame } from '../wire/envelope';
import type { WireExt } from '../wire/envelope';

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
}

/**
 * Runtime implementation of {@link RemoteClient}. Created by
 * `BrokerCore.createRemoteClient`; never constructed by user code.
 * @internal
 */
export class RemoteClientImpl implements RemoteClient {
  readonly id: string;
  readonly kind: string;
  readonly identity: RemoteIdentity['mode'];
  readonly duplex: boolean;
  readonly fanout: boolean;
  readonly requests: boolean;
  readonly ready: Promise<void>;
  readonly createdAt = Date.now();
  pending = 0;

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

    this.#unsubscribe = transport.onMessage((raw) => this.#handleIncoming(raw));
    this.#offClose = transport.onClose?.(() => this.destroy()) ?? null;
  }

  get forwardPatterns(): ReadonlyArray<string> {
    return this.#forward;
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
    const frame = buildFrame(message, this.#host.origin);
    const deliver = () => {
      if (this.#destroyed) return;
      try {
        this.#transport.send(frame);
      } catch (error) {
        this.#host.sendFailed(this.id, message.topic, message.id, 'TRANSPORT_THREW', error);
      }
    };
    if (this.#readyState === 'ready') {
      deliver();
      return;
    }
    if (this.#readyState === 'failed') {
      this.#host.sendFailed(this.id, message.topic, message.id, 'NOT_OPEN');
      return;
    }
    this.ready.then(deliver, (error: unknown) => {
      this.#host.sendFailed(this.id, message.topic, message.id, 'NOT_OPEN', error);
    });
  }

  // ── inbound ────────────────────────────────────────────────────────────

  #handleIncoming(raw: unknown): void {
    if (this.#destroyed) return;

    if (this.#maxBytes !== undefined && typeof raw === 'string' && raw.length > this.#maxBytes) {
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

    // Response frames are matched to pending requests by correlationId
    // (later step); until then nothing waits for them, and they must not
    // be routed as events.
    if (frame.kind === 'response') return;

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
    if (this.#destroyed) return;
    this.#destroyed = true;
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
