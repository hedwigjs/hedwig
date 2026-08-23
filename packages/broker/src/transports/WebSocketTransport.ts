import type { BridgeTransport } from '../core/bridge/Bridge.types';

/**
 * WebSocketTransport - Transport wrapper for WebSocket
 *
 * Simple wrapper that forwards messages to/from an existing WebSocket.
 * All connection management (connect, reconnect, etc.) is handled externally.
 */
export class WebSocketTransport implements BridgeTransport {
  #socket: WebSocket;
  #messageCallback: ((data: unknown) => void) | null = null;
  #messageHandler: ((e: MessageEvent) => void) | null = null;

  /**
   * @param socket - WebSocket instance (managed externally)
   */
  constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  /**
   * Send data to server via WebSocket
   */
  send(data: unknown): void {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocketTransport] Cannot send: socket not open');
      return;
    }

    try {
      this.#socket.send(JSON.stringify(data));
    } catch (error) {
      console.error('[WebSocketTransport] Failed to send:', error);
    }
  }

  /**
   * Subscribe to messages from server
   */
  onMessage(callback: (data: unknown) => void): () => void {
    this.#messageCallback = callback;

    this.#messageHandler = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        this.#messageCallback?.(data);
      } catch (error) {
        console.error('[WebSocketTransport] Failed to parse message:', error);
      }
    };

    this.#socket.addEventListener('message', this.#messageHandler);

    return () => this.destroy();
  }

  /**
   * Cleanup: remove listener (does NOT close socket)
   */
  destroy(): void {
    if (this.#messageHandler) {
      this.#socket.removeEventListener('message', this.#messageHandler);
      this.#messageHandler = null;
    }
    this.#messageCallback = null;
  }
}
