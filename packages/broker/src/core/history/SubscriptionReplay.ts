import { RoutingResult, RoutingReason } from '../routing/RoutingResult';

import type { ClientID, MessageHandler, SubscriptionOptions } from '../types';
import type { MessageHistory } from './MessageHistory';
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
 *  - async scheduling via `queueMicrotask` so that `subscribe()` returns
 *    immediately and replay never blocks the subscription establishment;
 *  - per-message and per-query error isolation — a failing handler for one
 *    historical entry does not abort the rest of the replay.
 *
 * The class is instantiated by BrokerCore only when history is enabled, so its
 * `history` dependency is always present (no null-checks inside). This removes
 * the `this.#history!` non-null assertion from the broker.
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
   * Asynchronously replay matching history entries to the given subscription.
   *
   * Does NOT await completion — returns immediately while the replay runs on
   * the microtask queue. Callers should not assume replay is finished when
   * this method returns.
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
    queueMicrotask(async () => {
      try {
        const entries = await this.#history.query({
          topics: [topic],
          limit: options.limit,
          since: options.since,
          until: options.until,
        });

        for (const entry of entries) {
          try {
            const recipient = entry.message.target;

            // Security: unicast messages are only replayed to their original
            // recipient. Multicast (`*`) is replayed to every new subscriber.
            if (recipient !== '*' && recipient !== clientId) continue;

            const replayedMessage = {
              ...entry.message,
              replayed: true,
            };

            await handler(replayedMessage);

            // Feed replayed messages into afterSend so observers (DevTools)
            // see them in the feed. beforeSend is intentionally skipped —
            // the message was already validated when it was originally sent.
            this.#hooks.afterSend(
              replayedMessage as any,
              RoutingResult.create(
                'ACK',
                RoutingReason.REPLAY_DELIVERED,
                `Replayed to '${clientId}'`,
                clientId,
              ),
            );
          } catch (error) {
            this.#logger.error('replay.handler.failed', {
              messageId: entry.message.id,
              clientId,
              error,
            });
          }
        }
      } catch (error) {
        this.#logger.error('replay.query.failed', { clientId, error });
      }
    });
  }
}
