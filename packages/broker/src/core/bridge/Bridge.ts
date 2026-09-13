import type { Message } from '../types';
import type {
  Bridge as IBridge,
  BridgeConfig,
  BridgeTransport,
  ExternalMessageInjector,
  InvalidFrameReason,
} from './Bridge.types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';
import { matchesAnyPattern } from '../utils/matchPattern';

/**
 * Bridge - Transport layer for cross-context communication
 *
 * Bridge is NOT a client in the message system.
 * It's infrastructure that forwards messages between broker and external contexts.
 *
 * Responsibilities:
 * - OUTBOUND: When broker calls send(), forward message to transport
 * - INBOUND: Listen to transport, validate the frame, inject into broker
 *
 * Use cases:
 * - iframe communication (PostMessageTransport)
 * - cross-tab sync (BroadcastChannelTransport)
 * - server messages (WebSocketTransport)
 */
export class Bridge<T extends string = string, P extends Record<T, any> = any>
  implements IBridge
{
  #inject: ExternalMessageInjector<T, P>;
  #transport: BridgeTransport;
  #patterns: string[];
  #allowedSources: ReadonlySet<string> | null;
  #unsubscribe: (() => void) | null = null;
  #logger: BrokerLogger;
  #onInvalid: (reason: InvalidFrameReason, raw: unknown) => void;

  constructor(
    inject: ExternalMessageInjector<T, P>,
    config: BridgeConfig,
    logger: BrokerLogger,
    onInvalid: (reason: InvalidFrameReason, raw: unknown) => void = () => {},
  ) {
    this.#inject = inject;
    this.#transport = config.transport;
    this.#patterns = config.forward;
    this.#allowedSources = config.allowedSources ? new Set(config.allowedSources) : null;
    this.#logger = logger;
    this.#onInvalid = onInvalid;

    // Start listening for incoming messages from transport
    this.#unsubscribe = this.#transport.onMessage((data) => {
      this.#handleIncoming(data);
    });
  }

  get forwardPatterns(): ReadonlyArray<string> {
    return this.#patterns;
  }

  /**
   * Human-friendly transport class name, derived from the constructor —
   * `WebSocket` for `WebSocketTransport`, etc. Used by DevTools to label
   * bridges. `undefined` for anonymous-class transports.
   */
  get transportKind(): string | undefined {
    const raw = this.#transport.constructor?.name;
    if (!raw) return undefined;
    return raw.endsWith("Transport") ? raw.slice(0, -"Transport".length) : raw;
  }

  /**
   * Check if topic matches forward patterns
   */
  shouldForward(topic: string): boolean {
    return matchesAnyPattern(topic, this.#patterns);
  }

  /**
   * Send message to transport (OUTBOUND)
   * Called by BrokerCore when message matches forward patterns
   */
  send(message: Message): void {
    this.#transport.send(message);
  }

  /**
   * Handle incoming message from transport (INBOUND)
   * Validate and inject into broker
   */
  #handleIncoming(data: unknown): void {
    const parsed = this.#parseMessage(data);
    if (!parsed.ok) {
      this.#onInvalid(parsed.reason, data);
      return;
    }
    const message = parsed.message;

    // Only process messages that match our patterns
    if (!this.shouldForward(message.topic)) return;

    if (this.#allowedSources && !this.#allowedSources.has(message.source)) {
      this.#onInvalid('SOURCE_NOT_ALLOWED', data);
      return;
    }

    // Internal injection path — does NOT forward back to bridges and does NOT
    // record into history (the other side already did). The `fromExternal`
    // flag is set inside the inject callback wired by BrokerCore.
    void this.#inject(
      message.topic as T,
      message.source,
      message.target,
      message.data,
    );
  }

  /**
   * Parse raw data into a Message-shaped frame.
   *
   * Every field the pipeline relies on is checked: `topic`, `source` and
   * `target` must be non-empty strings and `data` must be present (any
   * value, including `null`). Anything else is rejected with a reason so the
   * broker can publish `bridge.message.invalid` — a malformed frame must
   * never reach hooks or routing.
   */
  #parseMessage(data: unknown): { ok: true; message: Message } | { ok: false; reason: InvalidFrameReason } {
    let message: unknown;
    try {
      // Handle both string (JSON) and object data
      message = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      this.#logger.error('bridge.message.parse_failed', { error });
      return { ok: false, reason: 'MALFORMED' };
    }

    if (!message || typeof message !== 'object') return { ok: false, reason: 'MALFORMED' };
    const m = message as Record<string, unknown>;
    if (typeof m.topic !== 'string' || m.topic.length === 0) return { ok: false, reason: 'MALFORMED' };
    if (typeof m.source !== 'string' || m.source.length === 0) return { ok: false, reason: 'MALFORMED' };
    if (typeof m.target !== 'string' || m.target.length === 0) return { ok: false, reason: 'MALFORMED' };
    if (!('data' in m)) return { ok: false, reason: 'MALFORMED' };

    return { ok: true, message: m as unknown as Message };
  }

  /**
   * Cleanup: stop listening and destroy transport
   */
  destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#transport.destroy();
  }
}
