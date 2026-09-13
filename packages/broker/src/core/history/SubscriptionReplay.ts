import { RoutingResult, RoutingReason } from '../routing/RoutingResult';

import type { ClientID, Message, MessageHandler, SubscriptionOptions } from '../types';
import type { MessageHistory } from './MessageHistory';
import type { HistoryEntry } from './MessageHistory.types';
import type { HooksRegistry } from '../hooks/HooksRegistry';
import type { BrokerLogger } from '../logger/BrokerLogger.types';

/**
 * SubscriptionReplay - delivers historical messages to a newly created subscription.
 *
 * This is a standalone subsystem on top of {@link MessageHistory}. It encapsulates
 * everything BrokerCore would otherwise need to inline at the subscription site:
 *
 *  - querying the history by topic / time window / limit;
 *  - routing-level security: a unicast message is replayed ONLY to its original
 *    recipient; multicast messages are replayed to every new subscriber;
 *  - shaping the message (shallow copy + `replayed: true` flag);
 *  - invoking the subscriber's handler;
 *  - emitting an `afterSend` hook so observers (DevTools, logging) see replayed
 *    messages in the feed — note that replayed messages do NOT pass through
 *    `beforeSend`, they have already been validated at original emit time;
 *  - per-message error isolation — a failing handler for one historical entry
 *    does not abort the rest of the replay.
 *
 * ## Timing: synchronous, on the subscriber's stack
 *
 * Replay runs inside `subscribe()`, before `on()` returns. That is the only
 * way to give two guarantees at once:
 *
 *  1. **Old before new.** Every replayed entry reaches the handler before any
 *     live message emitted after `on()` returns. A deferred replay (microtask)
 *     let a live emit from the same tick arrive first, then the older entries
 *     landed on top of it — a late-mounted view would flash a stale snapshot
 *     over a fresh one.
 *  2. **No duplicates.** The history snapshot is taken synchronously, so a
 *     message emitted after `on()` cannot be both delivered live and replayed.
 *
 * Handlers are invoked in order but not awaited (same fire-and-forget rule as
 * multicast); an async handler's rejection is caught and logged.
 *
 * Which topics have anything to replay is decided by the registry
 * (`retention` in the contract); a topic without it simply yields no entries.
 */
export class SubscriptionReplay<T extends string, P extends Record<T, any>> {
  #history: MessageHistory<T, P>;
  #hooks: HooksRegistry<T, P>;
  #logger: BrokerLogger;

  constructor(history: MessageHistory<T, P>, hooks: HooksRegistry<T, P>, logger: BrokerLogger) {
    this.#history = history;
    this.#hooks = hooks;
    this.#logger = logger;
  }

  /**
   * Replay matching history entries to the given subscription, synchronously.
   *
   * Returns once every matching entry has been handed to the handler. Async
   * handlers may still be running; their completion is not awaited.
   *
   * @param clientId - Target subscriber identifier.
   * @param topic - Subscribed topic (supports glob; forwarded to history.query).
   * @param handler - Handler to receive each replayed message.
   * @param options - Replay window (`limit`, `since`, `until`).
   */
  start(
    clientId: ClientID,
    topic: T,
    handler: MessageHandler,
    options: NonNullable<SubscriptionOptions['replay']>,
  ): void {
    let entries: HistoryEntry<T, P[T]>[];
    try {
      entries = this.#history.querySync({
        topics: [topic],
        limit: options.limit,
        since: options.since,
        until: options.until,
      });
    } catch (error) {
      this.#logger.error('replay.query.failed', { clientId, error });
      return;
    }

    for (const entry of entries) {
      // History holds multicasts only (requests are never recorded), so
      // every entry is for every new subscriber.
      const replayedMessage: Message<T, P[T]> = {
        ...entry.message,
        replayed: true,
      };

      this.#invoke(clientId, replayedMessage, handler);

      // Feed replayed messages into afterSend so observers (DevTools)
      // see them in the feed. beforeSend is intentionally skipped —
      // the message was already validated when it was originally sent.
      this.#hooks.afterSend(
        replayedMessage,
        RoutingResult.create(
          'ACK',
          RoutingReason.REPLAY_DELIVERED,
          `Replayed to '${clientId}'`,
          clientId,
        ),
      );
    }
  }

  /**
   * Invoke the handler with error isolation for both sync throws and async
   * rejections. Never awaits — replay must stay synchronous.
   */
  #invoke(clientId: ClientID, message: Message<T, P[T]>, handler: MessageHandler): void {
    const log = (error: unknown) => {
      this.#logger.error('replay.handler.failed', {
        messageId: message.id,
        topic: message.topic,
        clientId,
        error,
      });
    };

    try {
      const result = handler(message);
      if (result !== null && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(undefined, log);
      }
    } catch (error) {
      log(error);
    }
  }
}
