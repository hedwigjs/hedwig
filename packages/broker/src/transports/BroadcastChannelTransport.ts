import type { BridgeTransport } from '../core/bridge/Bridge.types';

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
export class BroadcastChannelTransport implements BridgeTransport {
  #channel: BroadcastChannel;
  #messageCallback: ((data: unknown) => void) | null = null;

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
    try {
      this.#channel.postMessage(data);
    } catch (error) {
      console.error('[BroadcastChannelTransport] Failed to send:', error);
    }
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
    this.#channel.onmessage = null;
    this.#messageCallback = null;
    this.#channel.close();
  }
}
