import type { Transport } from '../core/transport/Transport.types';

/**
 * WebSocketTransport - Transport wrapper for WebSocket
 *
 * Forwards frames to/from a WebSocket the caller constructed. Connecting
 * and reconnecting stay outside: `ready` resolves once the socket is OPEN,
 * `onClose` fires when it closes (the runtime then destroys the remote
 * client, freeing its id for the next attempt). `destroy()` closes the
 * socket if it is still connecting or open — the remote client owns its
 * transport.
 */
export class WebSocketTransport implements Transport {
  readonly duplex = true;
  readonly fanout = false;
  /** Resolves once the socket is OPEN; rejects if it closes first. */
  readonly ready: Promise<void>;
  #socket: WebSocket;
  #messageCallback: ((data: unknown, meta?: { bytes?: number }) => void) | null = null;
  #destroyed = false;
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
    // After destroy() a send is a documented no-op (conformance: "send
    // after destroy must not throw"). Any other failure is thrown: the
    // runtime turns it into `remote.send.failed` so the caller and DevTools
    // see it, instead of a console line nobody reads.
    if (this.#destroyed) return;
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error(`[WebSocketTransport] socket is not open (readyState ${this.#socket.readyState})`);
    }
    this.#socket.send(JSON.stringify(data));
  }

  /**
   * Subscribe to messages from server
   */
  onMessage(callback: (data: unknown, meta?: { bytes?: number }) => void): () => void {
    this.#messageCallback = callback;

    this.#messageHandler = (e: MessageEvent) => {
      try {
        if (typeof e.data === 'string') {
          this.#messageCallback?.(JSON.parse(e.data), { bytes: e.data.length });
        } else {
          this.#messageCallback?.(e.data);
        }
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
    this.#destroyed = true;
    if (this.#messageHandler) {
      this.#socket.removeEventListener('message', this.#messageHandler);
      this.#messageHandler = null;
    }
    this.#messageCallback = null;
    const state = this.#socket.readyState;
    if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
      this.#socket.close();
    }
  }
}
