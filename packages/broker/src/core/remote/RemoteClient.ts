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

/**
 * What a remote client needs from the core. Injected as callbacks so the
 * class never holds a reference to `BrokerCore`.
 * @internal
 */
export interface RemoteHost {
  logger: BrokerLogger;
  /** Run the pipeline for an inbound frame with `fromExternal` and `via` set. */
  inject(
    remoteId: string,
    topic: string,
    source: ClientID,
    target: string,
    data: unknown,
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

interface ParsedFrame {
  topic: string;
  source: string | undefined;
  target: string;
  data: unknown;
  kind: string | undefined;
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
   * Send a local message to the remote as a wire frame. Local-only flags
   * (`replayed`, `fromExternal`, `synthetic`, `via`) never go on the wire.
   * Waits for the transport's `ready`; a send that still fails is reported
   * as `remote.send.failed`, never thrown into the emitter's pipeline.
   * @internal
   */
  send(message: Message): void {
    if (this.#destroyed) return;
    const frame = {
      id: message.id,
      topic: message.topic,
      source: message.source,
      target: message.target,
      data: message.data,
      timestamp: message.timestamp,
    };
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

    const parsed = this.#parse(raw);
    if (!parsed) {
      this.#host.frameRejected(this.id, 'MALFORMED', this.#claimed(raw));
      return;
    }

    // Response frames are matched to pending requests (later step); until
    // then nothing waits for them, and they must not be routed as events.
    if (parsed.kind === 'response') return;
    if (parsed.kind !== undefined && parsed.kind !== 'event' && parsed.kind !== 'request') {
      this.#host.frameRejected(this.id, 'UNSUPPORTED', { source: parsed.source, topic: parsed.topic });
      return;
    }

    if (!matchesAnyPattern(parsed.topic, this.#accepts)) {
      this.#host.frameRejected(this.id, 'TOPIC_NOT_ACCEPTED', { source: parsed.source, topic: parsed.topic });
      return;
    }

    const source = this.#resolveSource(parsed.source);
    if (!source.ok) {
      this.#host.frameRejected(this.id, source.reason, { source: parsed.source, topic: parsed.topic });
      return;
    }

    void this.#host.inject(this.id, parsed.topic, source.value, parsed.target, parsed.data);
  }

  #resolveSource(claimed: string | undefined): { ok: true; value: string } | { ok: false; reason: RemoteFrameRejectReason } {
    const identity = this.#identity;
    switch (identity.mode) {
      case 'fixed':
        if (claimed === undefined || claimed === '' || claimed === this.id) return { ok: true, value: this.id };
        return { ok: false, reason: 'SOURCE_MISMATCH' };
      case 'allow':
        if (claimed !== undefined && identity.sources.includes(claimed)) return { ok: true, value: claimed };
        return { ok: false, reason: 'SOURCE_NOT_ALLOWED' };
      case 'prefix': {
        if (claimed === undefined || claimed === '') return { ok: false, reason: 'MALFORMED' };
        return { ok: true, value: `${identity.prefix ?? this.id}:${claimed}` };
      }
    }
  }

  /**
   * Structural check equivalent to the wire schema: `topic` and `target`
   * non-empty strings, `data` present, `source` a string when present,
   * `kind` a string when present. Nothing else is interpreted here.
   */
  #parse(raw: unknown): ParsedFrame | null {
    let frame: unknown = raw;
    if (typeof raw === 'string') {
      try {
        frame = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (!frame || typeof frame !== 'object') return null;
    const f = frame as Record<string, unknown>;
    if (typeof f.topic !== 'string' || f.topic.length === 0) return null;
    if (typeof f.target !== 'string' || f.target.length === 0) return null;
    if (!('data' in f)) return null;
    if (f.source !== undefined && typeof f.source !== 'string') return null;
    if (f.kind !== undefined && typeof f.kind !== 'string') return null;
    return {
      topic: f.topic,
      source: f.source as string | undefined,
      target: f.target,
      data: f.data,
      kind: f.kind as string | undefined,
    };
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
