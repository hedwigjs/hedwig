import type { Message, ClientID, MessageHandler } from '../types';
import type { Subscriptions, SubscriptionEntry } from './Subscriptions';
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
 * - Forwarding to remote clients (delegated to BrokerCore)
 * - Message creation (delegated to BrokerCore)
 *
 * Design: Uses Dependency Injection to receive Subscriptions (read-only access)
 */
export class Router<T extends string, P extends Record<T, any>> {
  #subscriptions: Subscriptions<T>;
  #logger: BrokerLogger;
  /** `(clientId:topic)` pairs already warned about for multiple unicast handlers. */
  #warnedMultiHandler = new Set<string>();

  constructor(subscriptions: Subscriptions<T>, logger: BrokerLogger) {
    this.#subscriptions = subscriptions;
    this.#logger = logger;
  }

  /**
   * Route unicast message to specific recipient.
   *
   * A request is answered by exactly one handler: the FIRST one the
   * recipient registered on the topic. Additional handlers are never
   * invoked for unicast (a warning is logged once per `(client, topic)`).
   *
   * Unicast bypasses backpressure. Throttle / debounce / rateLimit shape
   * *event* consumption; a request is a call whose caller is waiting for
   * an answer, so it always reaches the subscriber's original handler and
   * always produces a result.
   *
   * @param timeout - Optional ms budget for the handler. On expiry the
   *   result is `NACK TIMEOUT`; the handler keeps running on its own.
   */
  async unicast<K extends T, R = unknown>(
    message: Message<K, P[K]>,
    recipient: ClientID,
    timeout?: number,
  ): Promise<RoutingResult<R>> {
    if (!this.#subscriptions.isSubscribed(recipient, message.topic)) {
      return RoutingResult.create<R>(
        'NACK',
        RoutingReason.NOT_SUBSCRIBED,
        `Client '${recipient}' not subscribed to '${message.topic}'`,
        recipient,
      );
    }

    const entries = this.#subscriptions.getEntries(recipient, message.topic);
    if (entries.length > 1) {
      const key = `${recipient}:${message.topic}`;
      if (!this.#warnedMultiHandler.has(key)) {
        this.#warnedMultiHandler.add(key);
        this.#logger.warn('unicast.multiple_handlers', {
          clientId: recipient,
          topic: message.topic,
          handlers: entries.length,
        });
      }
    }

    const first = entries[0];
    const handler = first?.rawHandler ?? first?.handler;
    const outcome = await this.#executeHandler<R>(message, handler, recipient, timeout);

    if (outcome.timedOut) {
      return RoutingResult.create<R>(
        'NACK',
        RoutingReason.TIMEOUT,
        `Request to '${recipient}' timed out after ${timeout} ms`,
        recipient,
      );
    }

    return RoutingResult.create<R>(
      outcome.success ? 'ACK' : 'NACK',
      outcome.success ? RoutingReason.DELIVERED : RoutingReason.HANDLER_FAILED,
      outcome.success
        ? `Message delivered and handled by '${recipient}'`
        : `Message not handled by '${recipient}'`,
      recipient,
      outcome.data,
    );
  }

  /**
   * Route multicast message to all subscribers except sender.
   *
   * A subscriber may have registered multiple handlers on the topic — every
   * one of them fires. The `dispatched` count reflects unique recipients
   * (not handler invocations) to keep the ACK payload consistent with the
   * subscriber-centric mental model.
   *
   * The sender is excluded by default; a subscription created with
   * `noLocal: false` also receives the client's own emits.
   *
   * Handlers run fire-and-forget — ACK means dispatch completed, not that
   * every subscriber finished processing the message. Handlers are invoked
   * synchronously, in registration order, on the caller's stack. A handler
   * that emits another message therefore runs that nested dispatch inline:
   * other subscribers see the nested message *before* they see the outer
   * one. This is documented behaviour, not a bug — keep handlers short or
   * defer follow-up emits if ordering matters.
   *
   * ## Mutation during dispatch
   *
   * The recipient plan is snapshotted before any handler runs, so a
   * handler that subscribes or unsubscribes cannot corrupt the iteration
   * (a spliced live array would silently skip the next element). The
   * observable rules match DOM `EventTarget`:
   *
   *  - a handler unsubscribed mid-dispatch — by itself or by another
   *    handler — is NOT invoked if it hasn't run yet; `off()` is immediate;
   *  - a handler subscribed mid-dispatch does NOT receive the in-flight
   *    message; it starts with the next one.
   */
  async multicast<K extends T>(message: Message<K, P[K]>, sender: ClientID): Promise<RoutingResult> {
    const plan = this.#planMulticast(message.topic, sender);

    const dispatched: ClientID[] = [];
    for (const { clientId, entries } of plan) {
      let invoked = false;
      for (const entry of entries) {
        // Re-check liveness: an earlier handler may have unsubscribed this one.
        if (!this.#subscriptions.isActive(entry.id)) continue;
        this.#executeHandlerFireAndForget(message, entry.handler, clientId);
        invoked = true;
      }
      if (invoked) dispatched.push(clientId);
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
   * Snapshot every recipient together with a copy of its handler list,
   * before any handler is invoked. The sender's own handlers are included
   * only when subscribed with `noLocal: false`.
   * @private
   */
  #planMulticast(
    topic: T,
    sender: ClientID,
  ): Array<{ clientId: ClientID; entries: readonly SubscriptionEntry[] }> {
    const plan: Array<{ clientId: ClientID; entries: readonly SubscriptionEntry[] }> = [];
    for (const clientId of this.#subscriptions.getSubscribers(topic)) {
      const all = this.#subscriptions.getEntries(clientId, topic);
      const entries =
        clientId === sender ? all.filter((e) => e.options?.noLocal === false) : all.slice();
      if (entries.length === 0) continue;
      plan.push({ clientId, entries });
    }
    return plan;
  }

  /**
   * Execute a handler with error handling, response capture and an
   * optional timeout. The handler is invoked synchronously (its return
   * value may be a promise); the timeout only bounds how long we wait.
   * @private
   */
  async #executeHandler<R = unknown>(
    message: Message<T, P[T]>,
    handler: MessageHandler | undefined,
    clientId: ClientID,
    timeout: number | undefined,
  ): Promise<{ success: boolean; data?: R; timedOut?: boolean }> {
    if (!handler) return { success: false };

    const meta = {
      clientId,
      messageId: message.id,
      topic: message.topic,
      source: message.source,
    };

    let pending: unknown;
    try {
      pending = handler(message);
    } catch (handlerError) {
      this.#logger.error('handler.failed', { ...meta, error: handlerError });
      return { success: false };
    }

    if (timeout === undefined) {
      try {
        return { success: true, data: (await pending) as R };
      } catch (handlerError) {
        this.#logger.error('handler.failed', { ...meta, error: handlerError });
        return { success: false };
      }
    }

    const TIMED_OUT = Symbol('timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeout);
    });
    try {
      const settled = await Promise.race([Promise.resolve(pending), deadline]);
      if (settled === TIMED_OUT) {
        this.#logger.warn('handler.failed', { ...meta, error: `timed out after ${timeout} ms` });
        // The handler's own promise may still reject later — don't let that
        // become an unhandled rejection.
        Promise.resolve(pending).catch(() => {});
        return { success: false, timedOut: true };
      }
      return { success: true, data: settled as R };
    } catch (handlerError) {
      this.#logger.error('handler.failed', { ...meta, error: handlerError });
      return { success: false };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Execute handler in fire-and-forget mode (for multicast)
   * @private
   */
  #executeHandlerFireAndForget(message: Message<T, P[T]>, handler: MessageHandler, clientId: ClientID): void {
    const meta = {
      clientId,
      messageId: message.id,
      topic: message.topic,
      source: message.source,
    };
    try {
      Promise.resolve(handler(message)).catch((handlerError: unknown) => {
        this.#logger.error('handler.failed', { ...meta, error: handlerError });
      });
    } catch (handlerError: unknown) {
      this.#logger.error('handler.failed', { ...meta, error: handlerError });
    }
  }
}
