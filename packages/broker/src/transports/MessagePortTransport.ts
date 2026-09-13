import type { Transport } from '../core/transport/Transport.types';

/**
 * MessagePortTransport — 1:1 duplex pipe over a `MessagePort`.
 *
 * Covers Web Workers (`worker` ports via `MessageChannel`), SharedWorkers
 * (`port` from `onconnect`) and `MessageChannel` between documents. There
 * is no origin concept on a port: whoever holds the other end is the peer,
 * so possession of the port is the trust decision.
 *
 * Frames travel by structured clone; binary payloads are fine.
 */
export class MessagePortTransport implements Transport {
  readonly duplex = true;
  readonly fanout = false;
  #port: MessagePort;
  #callback: ((frame: unknown) => void) | null = null;
  #handler: ((e: MessageEvent) => void) | null = null;

  constructor(port: MessagePort) {
    this.#port = port;
  }

  send(frame: unknown): void {
    this.#port.postMessage(frame);
  }

  onMessage(callback: (frame: unknown) => void): () => void {
    this.#callback = callback;
    this.#handler = (e: MessageEvent) => {
      this.#callback?.(e.data);
    };
    this.#port.addEventListener('message', this.#handler);
    // `addEventListener` (unlike `onmessage`) does not start the port.
    this.#port.start();
    return () => this.destroy();
  }

  destroy(): void {
    if (this.#handler) {
      this.#port.removeEventListener('message', this.#handler);
      this.#handler = null;
    }
    this.#callback = null;
    this.#port.close();
  }
}
