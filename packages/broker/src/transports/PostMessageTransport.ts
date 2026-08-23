import type { BridgeTransport } from '../core/bridge/Bridge.types';

/**
 * Configuration for PostMessageTransport
 */
export interface PostMessageTransportConfig {
  /** Target window to communicate with (iframe.contentWindow, window.parent, etc.) */
  target: Window;

  /** Target origin for security. Use '*' only for trusted contexts */
  origin?: string;
}

/**
 * PostMessageTransport - Transport for cross-window communication
 *
 * Uses window.postMessage for iframe/popup communication.
 *
 * Security:
 * - Validates message origin
 * - Validates message source window
 */
export class PostMessageTransport implements BridgeTransport {
  #target: Window;
  #origin: string;
  #messageHandler: ((e: MessageEvent) => void) | null = null;
  #messageCallback: ((data: unknown) => void) | null = null;

  constructor(config: PostMessageTransportConfig) {
    this.#target = config.target;
    this.#origin = config.origin ?? '*';
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

    this.#messageHandler = (e: MessageEvent) => {
      // Only process messages from our target window
      if (e.source !== this.#target) {
        return;
      }

      // Validate origin for security
      if (this.#origin !== '*' && e.origin !== this.#origin) {
        console.warn(
          `[PostMessageTransport] Message from unauthorized origin: ${e.origin} (expected: ${this.#origin})`,
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
