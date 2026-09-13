import type { Transport } from '../core/transport/Transport.types';

/**
 * BroadcastChannelTransport - Transport for cross-tab communication
 *
 * Uses BroadcastChannel API for communication between browser tabs
 * of the same origin.
 *
 * Use cases:
 * - Sync user session across tabs
 * - Sync theme/locale preferences
 * - Broadcast notifications to all tabs
 */
export class BroadcastChannelTransport implements Transport {
  readonly duplex = true;
  /** One `send` reaches every other tab; inbound may come from any of them. */
  readonly fanout = true;
  #channel: BroadcastChannel;
  #messageCallback: ((data: unknown) => void) | null = null;
  #destroyed = false;

  /**
   * @param channelName - Unique channel name for this application
   */
  constructor(channelName: string) {
    this.#channel = new BroadcastChannel(channelName);
  }

  /**
   * Broadcast data to all other tabs
   */
  send(data: unknown): void {
    // Thrown errors become `remote.send.failed` in the runtime; after
    // destroy() the channel is closed and a send is a no-op by contract.
    if (this.#destroyed) return;
    this.#channel.postMessage(data);
  }

  /**
   * Subscribe to messages from other tabs
   */
  onMessage(callback: (data: unknown) => void): () => void {
    this.#messageCallback = callback;

    this.#channel.onmessage = (e: MessageEvent) => {
      this.#messageCallback?.(e.data);
    };

    return () => this.destroy();
  }

  /**
   * Cleanup: close the channel
   */
  destroy(): void {
    this.#destroyed = true;
    this.#channel.onmessage = null;
    this.#messageCallback = null;
    this.#channel.close();
  }
}
