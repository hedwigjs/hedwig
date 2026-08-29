import type { BridgeTransport } from '../core/bridge/Bridge.types';

/**
 * Configuration for PostMessageTransport
 */
export interface PostMessageTransportConfig {
  /** Target window to communicate with (iframe.contentWindow, window.parent, etc.) */
  target: Window;

  /**
   * Target origin for outbound `postMessage` calls.
   * Use `'*'` only for trusted contexts — the browser will otherwise refuse
   * to deliver the message if the target's origin doesn't match.
   * @default '*'
   */
  origin?: string;

  /**
   * Explicit allowlist for **inbound** message origins.
   *
   * When set, only messages whose `e.origin` is included in this list are
   * forwarded to the broker; others are dropped with a `console.warn`. This
   * is the trust boundary between the broker and cross-origin iframes.
   *
   * When omitted, inbound validation falls back to `origin`:
   *  - If `origin` is an explicit URL, it acts as a single-item allowlist.
   *  - If `origin` is `'*'`, all origins are accepted (a `console.warn` is
   *    emitted at construction time — this mode is intended only for
   *    trusted contexts and should not be used in production against
   *    untrusted iframes).
   *
   * Prefer setting `allowedOrigins` explicitly for cross-origin scenarios.
   */
  allowedOrigins?: string[];
}

/**
 * PostMessageTransport - Transport for cross-window communication
 *
 * Uses `window.postMessage` for iframe/popup communication.
 *
 * Security:
 * - Validates message source window (must match configured `target`).
 * - Validates message origin against `allowedOrigins` (explicit allowlist)
 *   or `origin` (fallback single-item allowlist).
 */
export class PostMessageTransport implements BridgeTransport {
  #target: Window;
  #origin: string;
  #allowedOrigins: readonly string[] | null;
  #wildcardWarned = false;
  #messageHandler: ((e: MessageEvent) => void) | null = null;
  #messageCallback: ((data: unknown) => void) | null = null;

  constructor(config: PostMessageTransportConfig) {
    this.#target = config.target;
    this.#origin = config.origin ?? '*';

    if (config.allowedOrigins !== undefined) {
      this.#allowedOrigins = [...config.allowedOrigins];
    } else if (this.#origin !== '*') {
      // Backward compatible: use `origin` as an implicit single-item allowlist.
      this.#allowedOrigins = [this.#origin];
    } else {
      // Wildcard mode: accept any origin (source-window check still applies).
      // Warning is deferred until the first `onMessage` call — send-only usage
      // is not an inbound vector and does not need a security warning.
      this.#allowedOrigins = null;
    }
  }

  /**
   * Send data to target window via postMessage
   */
  send(data: unknown): void {
    try {
      this.#target.postMessage(data, this.#origin);
    } catch (error) {
      console.error('[PostMessageTransport] Failed to send:', error);
    }
  }

  /**
   * Subscribe to incoming messages from target window
   */
  onMessage(callback: (data: unknown) => void): () => void {
    this.#messageCallback = callback;

    if (this.#allowedOrigins === null && !this.#wildcardWarned) {
      this.#wildcardWarned = true;
      console.warn(
        "[PostMessageTransport] Listening with wildcard origin ('*') and " +
          'no allowedOrigins — inbound messages from ANY origin will be ' +
          'accepted (source-window check still applies). Set `allowedOrigins` ' +
          'explicitly for cross-origin scenarios.',
      );
    }

    this.#messageHandler = (e: MessageEvent) => {
      // Only process messages from our target window
      if (e.source !== this.#target) {
        return;
      }

      // Validate origin against the allowlist (if any).
      if (this.#allowedOrigins !== null && !this.#allowedOrigins.includes(e.origin)) {
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
    if (this.#messageHandler) {
      window.removeEventListener('message', this.#messageHandler);
      this.#messageHandler = null;
    }
    this.#messageCallback = null;
  }
}
