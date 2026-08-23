import type { Message, ClientID, MessageHandler } from '../types';
import type { Subscriptions } from './Subscriptions';
import type { BrokerLogger } from '../logger/BrokerLogger.types';
import { RoutingResult, RoutingReason } from './RoutingResult';

/**
 * Router - Pure message routing logic
 *
 * Responsibilities:
 * - Route messages to correct subscribers (unicast/multicast)
 * - Execute handlers
 * - Return delivery results
 *
 * Does NOT handle:
 * - Subscription management (delegated to Subscriptions)
 * - Hooks (delegated to HooksRegistry)
 * - Bridge forwarding (delegated to BrokerCore)
 * - Message creation (delegated to BrokerCore)
 *
 * Design: Uses Dependency Injection to receive Subscriptions (read-only access)
 */
export class Router<T extends string, P extends Record<T, any>> {
  #subscriptions: Subscriptions<T>;
  #logger: BrokerLogger;

  constructor(subscriptions: Subscriptions<T>, logger: BrokerLogger) {
    this.#subscriptions = subscriptions;
    this.#logger = logger;
  }

  /**
   * Route unicast message to specific recipient
   */
  async unicast<K extends T, R = unknown>(
    message: Message<K, P[K]>,
    recipient: ClientID,
  ): Promise<RoutingResult<R>> {
    if (!this.#subscriptions.isSubscribed(recipient, message.topic)) {
      return RoutingResult.create<R>(
        'NACK',
        RoutingReason.NOT_SUBSCRIBED,
        `Client '${recipient}' not subscribed to '${message.topic}'`,
        recipient,
      );
    }

    const handler = this.#subscriptions.getHandler(recipient, message.topic);
    const { success, data: responseData } = await this.#executeHandler<R>(message, handler);

    return RoutingResult.create<R>(
      success ? 'ACK' : 'NACK',
      success ? RoutingReason.DELIVERED : RoutingReason.HANDLER_FAILED,
      success
        ? `Message delivered and handled by '${recipient}'`
        : `Message not handled by '${recipient}'`,
      recipient,
      responseData,
    );
  }

  /**
   * Route multicast message to all subscribers except sender.
   *
   * Handlers run fire-and-forget — ACK means dispatch completed, not that
   * every subscriber finished processing the message.
   */
  async multicast<K extends T>(message: Message<K, P[K]>, sender: ClientID): Promise<RoutingResult> {
    const subscribers = this.#subscriptions.getSubscribers(message.topic);

    const dispatched: ClientID[] = [];
    for (const clientId of subscribers) {
      if (clientId === sender) continue;
      const handler = this.#subscriptions.getHandler(clientId, message.topic);
      if (handler) {
        this.#executeHandlerFireAndForget(message, handler, clientId);
        dispatched.push(clientId);
      }
    }

    if (dispatched.length === 0) {
      return RoutingResult.create('NACK', RoutingReason.NO_SUBSCRIBERS, `No subscribers for message '${message.topic}'`);
    }

    return RoutingResult.create(
      'ACK',
      RoutingReason.DISPATCHED,
      `Multicast dispatched to ${dispatched.length} subscriber${dispatched.length === 1 ? '' : 's'}`,
      undefined,
      undefined,
      dispatched,
    );
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  /**
   * Execute a handler with error handling and response capture
   * @private
   */
  async #executeHandler<R = unknown>(
    message: Message<T, P[T]>,
    handler: MessageHandler | undefined,
  ): Promise<{ success: boolean; data?: R }> {
    if (!handler) return { success: false };

    try {
      const result = await handler(message);
      return { success: true, data: result as R };
    } catch (handlerError) {
      this.#logger.error('handler.failed', { error: handlerError });
      return { success: false };
    }
  }

  /**
   * Execute handler in fire-and-forget mode (for multicast)
   * @private
   */
  #executeHandlerFireAndForget(message: Message<T, P[T]>, handler: MessageHandler, clientId: ClientID): void {
    try {
      Promise.resolve(handler(message)).catch((handlerError: unknown) => {
        this.#logger.error('handler.failed', { clientId, error: handlerError });
      });
    } catch (handlerError: unknown) {
      this.#logger.error('handler.failed', { clientId, error: handlerError });
    }
  }
}
