import type {
  ClientID,
  HandlerFn,
  MessageOptions,
  RequestOptions,
  SubscriptionOptions,
} from '../types';
import type { RoutingResult } from '../routing/RoutingResult';

/**
 * Client — the public contract of a broker-connected client.
 *
 * Instances are obtained via `createClient(id)`. Consumers should treat
 * this as the stable surface — the underlying class is an internal
 * implementation detail and may change in minor releases.
 *
 * A client provides three things:
 *  - subscription (`on` / `off`) to a topic,
 *  - message emission: broadcast (`emit`) or targeted (`request`),
 *  - lifecycle control (`reset`, `destroy`).
 */
export interface Client<T extends string, P extends Record<T, any>> {
  /** Unique client identifier passed to `createClient(id)`. */
  readonly id: ClientID;

  /**
   * Subscribe to a topic.
   *
   * With `options.replay`, matching history entries are delivered to the
   * handler synchronously — before this call returns — oldest first, each
   * flagged `replayed: true`. Live messages emitted afterwards always
   * arrive after the replayed ones and are never duplicated.
   *
   * @param topic - Topic name (e.g. `'user.login.v1'`).
   * @param handler - Handler invoked for every matching message.
   * @param options - Subscription options (backpressure strategy, replay).
   * @returns Unsubscribe function. Equivalent to `client.off(topic)`.
   * @throws If an `onSubscribe` hook rejects the subscription.
   */
  on<K extends T>(
    topic: K,
    handler: HandlerFn<K, P[K]>,
    options?: SubscriptionOptions,
  ): () => void;

  /**
   * Unsubscribe from a topic. No-op if the client was not subscribed.
   */
  off<K extends T>(topic: K): void;

  /**
   * Broadcast a message to every subscriber of `topic` (multicast).
   *
   * @returns Promise resolving to the aggregated {@link RoutingResult}.
   */
  emit<K extends T>(
    topic: K,
    data: P[K],
    options?: MessageOptions,
  ): Promise<RoutingResult>;

  /**
   * Send a targeted message to a specific recipient (unicast).
   *
   * The recipient's FIRST handler on the topic answers; it is called
   * directly, bypassing any backpressure configured on the subscription —
   * a request is always answered, never throttled or dropped.
   *
   * @typeParam R - Expected shape of the handler's return value, surfaced
   *   on `RoutingResult.data`. Defaults to `unknown` — caller must specify
   *   to get a typed response (e.g. `client.request<'user.fetch', User>(…)`).
   *   Not enforced against the handler signature; treated as a boundary cast.
   * @param options - `timeout` (ms) bounds the wait: on expiry the result is
   *   `NACK TIMEOUT` and the handler keeps running on its own.
   * @returns Promise resolving to the {@link RoutingResult} for that one
   *   recipient.
   */
  request<K extends T, R = unknown>(
    recipient: ClientID,
    topic: K,
    data: P[K],
    options?: RequestOptions,
  ): Promise<RoutingResult<R>>;

  /**
   * Reset the client: flush and drop every subscription and its
   * backpressure strategy while keeping the client registered.
   *
   * Used by `createClient(id)` for idempotent creation (HMR, re-mount).
   */
  reset(): void;

  /**
   * Destroy the client: unregister it and remove all its subscriptions.
   * After `destroy()` the client instance becomes inert.
   */
  destroy(): void;
}
