import type { Message } from '../types';
import type {
  Bridge as IBridge,
  BridgeConfig,
  BridgeTransport,
  ExternalMessageInjector,
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
 * - INBOUND: Listen to transport and inject messages into broker
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
  #unsubscribe: (() => void) | null = null;
  #logger: BrokerLogger;

  constructor(
    inject: ExternalMessageInjector<T, P>,
    config: BridgeConfig,
    logger: BrokerLogger,
  ) {
    this.#inject = inject;
    this.#transport = config.transport;
    this.#patterns = config.forward;
    this.#logger = logger;

    // Start listening for incoming messages from transport
    this.#unsubscribe = this.#transport.onMessage((data) => {
      this.#handleIncoming(data);
    });
  }

  get forwardPatterns(): ReadonlyArray<string> {
    return this.#patterns;
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
   * Parse and inject into broker
   */
  #handleIncoming(data: unknown): void {
    const message = this.#parseMessage(data);
    if (!message) return;

    // Only process messages that match our patterns
    if (!this.shouldForward(message.topic)) return;

    // Internal injection path — does NOT forward back to bridges and does NOT
    // record into history (the other side already did). The `fromExternal`
    // flag is set inside the inject callback wired by BrokerCore.
    this.#inject(
      message.topic as T,
      message.source,
      message.target,
      message.data,
    );
  }

  /**
   * Parse raw data into Message object
   */
  #parseMessage(data: unknown): Message | null {
    try {
      // Handle both string (JSON) and object data
      const message = typeof data === 'string' ? JSON.parse(data) : data;

      // Validate required fields
      if (!message || typeof message !== 'object') return null;
      if (!message.topic || typeof message.topic !== 'string') return null;

      return message as Message;
    } catch (error) {
      this.#logger.error('bridge.message.parse_failed', { error });
      return null;
    }
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
