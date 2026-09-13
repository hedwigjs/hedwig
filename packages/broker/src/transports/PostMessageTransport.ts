import type { Transport } from '../core/transport/Transport.types';

/**
 * Configuration for PostMessageTransport
 */
export interface PostMessageTransportConfig {
  /** Target window to communicate with (iframe.contentWindow, window.parent, etc.) */
  target: Window;

  /**
   * Target origin for outbound `postMessage` calls. Never `'*'` — that
   * hands every frame to whatever document happens to be loaded in the
   * target window.
   */
  targetOrigin: string;

  /**
   * Allowlist for **inbound** message origins. Only messages whose
   * `e.origin` is included are handed to the broker; others are dropped
   * with a `console.warn`. This is the trust boundary between the broker
   * and cross-origin documents.
   */
  allowedOrigins: string[];
}

/**
 * PostMessageTransport - Transport for cross-window communication
 *
 * Uses `window.postMessage` for iframe/popup communication.
 *
 * Security:
 * - Validates message source window (must match configured `target`).
 * - Validates message origin against `allowedOrigins`.
 * - Sends only to `targetOrigin`.
 */
export class PostMessageTransport implements Transport {
  #target: Window;
  #targetOrigin: string;
  #allowedOrigins: readonly string[];
  #messageHandler: ((e: MessageEvent) => void) | null = null;
  #messageCallback: ((data: unknown) => void) | null = null;
  #destroyed = false;

  readonly duplex = true;
  readonly fanout = false;

  constructor(config: PostMessageTransportConfig) {
    if (typeof config.targetOrigin !== 'string' || config.targetOrigin.length === 0) {
      throw new Error('@hedwigjs/broker: postmessage transport requires `targetOrigin`');
    }
    if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0) {
      throw new Error('@hedwigjs/broker: postmessage transport requires a non-empty `allowedOrigins`');
    }
    if (config.targetOrigin === '*' || config.allowedOrigins.includes('*')) {
      console.warn(
        "[PostMessageTransport] '*' as targetOrigin/allowedOrigins accepts or " +
          'exposes frames to ANY origin. Name the peer origin explicitly.',
      );
    }
    this.#target = config.target;
    this.#targetOrigin = config.targetOrigin;
    this.#allowedOrigins = [...config.allowedOrigins];
  }

  /**
   * Send data to target window via postMessage
   */
  send(data: unknown): void {
    // Thrown errors become `remote.send.failed` in the runtime; after
    // destroy() a send is a no-op by contract.
    if (this.#destroyed) return;
    this.#target.postMessage(data, this.#targetOrigin);
  }

  /**
   * Subscribe to incoming messages from target window
   */
  onMessage(callback: (data: unknown) => void): () => void {
    this.#messageCallback = callback;

    this.#messageHandler = (e: MessageEvent) => {
      // Only process messages from our target window
      if (e.source !== this.#target) {
        return;
      }

      // Validate origin against the allowlist.
      if (!this.#allowedOrigins.includes('*') && !this.#allowedOrigins.includes(e.origin)) {
        console.warn(
          `[PostMessageTransport] Message from unauthorized origin: ${e.origin} ` +
            `(allowed: ${this.#allowedOrigins.join(', ')})`,
        );
        return;
      }

      this.#messageCallback?.(e.data);
    };

    window.addEventListener('message', this.#messageHandler);

    return () => this.destroy();
  }

  /**
   * Cleanup: remove event listener
   */
  destroy(): void {
    this.#destroyed = true;
    if (this.#messageHandler) {
      window.removeEventListener('message', this.#messageHandler);
      this.#messageHandler = null;
    }
    this.#messageCallback = null;
  }
}
