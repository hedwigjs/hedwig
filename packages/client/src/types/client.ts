import type {
  ClientID,
  HandlerFn,
  MessageOptions,
  RequestOptions,
  SubscriptionOptions,
} from './message';
import type { RoutingResult } from './routing';

/**
 * A local participant: code in this realm that subscribes and sends.
 *
 * Obtained from `createClient(id)`. Three things: subscription (`on` /
 * `off`), emission (`emit` for fan-out, `request` for a targeted call
 * awaiting a typed answer), lifecycle (`reset`, `destroy`).
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
   * @returns Unsubscribe function. Equivalent to `client.off(topic)`.
   * @throws If an `onSubscribe` hook rejects the subscription.
   */
  on<K extends T>(topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): () => void;

  /** Unsubscribe from a topic. No-op if the client was not subscribed. */
  off<K extends T>(topic: K): void;

  /**
   * Broadcast a message to every subscriber of `topic` (multicast).
   * Remote clients whose `forward` patterns match receive it as a frame.
   */
  emit<K extends T>(topic: K, data: P[K], options?: MessageOptions): Promise<RoutingResult>;

  /**
   * Send a targeted message to one recipient (unicast) and await its answer.
   *
   * A local recipient's FIRST handler on the topic answers, bypassing any
   * backpressure on the subscription. A remote recipient is asked over its
   * transport; see {@link RoutingResult} reasons `TIMEOUT`, `REMOTE_GONE`,
   * `TRANSPORT_ONE_WAY`, `TRANSPORT_FANOUT`.
   *
   * @typeParam R - Expected shape of the answer, surfaced on
   *   `RoutingResult.data`. A boundary cast, not enforced against the handler.
   */
  request<K extends T, R = unknown>(
    recipient: ClientID,
    topic: K,
    data: P[K],
    options?: RequestOptions,
  ): Promise<RoutingResult<R>>;

  /** Drop every subscription and its backpressure state; stay registered. */
  reset(): void;

  /** Unregister and remove all subscriptions. The instance becomes inert. */
  destroy(): void;
}

/** Options for `createClient(id, options)`. */
export interface ClientOptions {
  /**
   * What to do when a client with this id already exists in the runtime.
   * `'throw'` (default): `CLIENT_ID_TAKEN` — two modules picking the same
   * id must not silently wipe each other's subscriptions. `'reset'`: return
   * the existing client with its subscriptions dropped (the old HMR
   * behaviour; prefer `module.hot.dispose(() => client.destroy())`).
   * @default 'throw'
   */
  onConflict?: 'throw' | 'reset';
}
