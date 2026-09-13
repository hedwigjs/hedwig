import type { BridgeTransport } from '../core/bridge/Bridge.types';

/**
 * WebSocketTransport - Transport wrapper for WebSocket
 *
 * Simple wrapper that forwards messages to/from an existing WebSocket.
 * All connection management (connect, reconnect, etc.) is handled externally.
 */
export class WebSocketTransport implements BridgeTransport {
  readonly duplex = true;
  readonly fanout = false;
  /** Resolves once the socket is OPEN; rejects if it closes first. */
  readonly ready: Promise<void>;
  #socket: WebSocket;
  #messageCallback: ((data: unknown) => void) | null = null;
  #messageHandler: ((e: MessageEvent) => void) | null = null;

  /**
   * @param socket - WebSocket instance (managed externally)
   */
  constructor(socket: WebSocket) {
    this.#socket = socket;
    this.ready =
      socket.readyState === WebSocket.OPEN
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const onOpen = () => {
              cleanup();
              resolve();
            };
            const onClose = () => {
              cleanup();
              reject(new Error('WebSocket closed before it opened'));
            };
            const cleanup = () => {
              socket.removeEventListener('open', onOpen);
              socket.removeEventListener('close', onClose);
              socket.removeEventListener('error', onClose);
            };
            socket.addEventListener('open', onOpen);
            socket.addEventListener('close', onClose);
            socket.addEventListener('error', onClose);
          });
    // A rejected `ready` is observed by the remote client; keep it from
    // surfacing as an unhandled rejection when nobody is waiting yet.
    this.ready.catch(() => {});
  }

  /** Fires when the socket closes; lets the runtime tear the remote down. */
  onClose(callback: () => void): () => void {
    const handler = () => callback();
    this.#socket.addEventListener('close', handler);
    return () => this.#socket.removeEventListener('close', handler);
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
