import type { BrokerCore } from '../BrokerCore';
import type { ClientID, HandlerFn, MessageHandler, SubscriptionOptions, MessageOptions } from '../types';
import type { RoutingResult } from '../routing/RoutingResult';
import type { Client } from './Client.types';

/**
 * BrokerClient — concrete implementation of the {@link Client} contract.
 *
 * Created by the facade function `createClient(id)`. Use cases:
 * - Communication between microfrontends in the same browser context
 * - Fastest possible message delivery (no serialization)
 * - Default choice for most applications
 *
 * Consumers should treat `Client<T, P>` as the stable surface — this
 * class is an internal implementation detail. It is exported within the
 * package so unit tests can construct instances directly with a
 * `BrokerCore` stub, but it is NOT part of the public API: transport of
 * `BrokerClient` through the package exports map is disabled.
 */
export class BrokerClient<T extends string, P extends Record<T, any>>
  implements Client<T, P>
{
  readonly id: ClientID;
  #core: BrokerCore<T, P>;

  constructor(id: ClientID, core: BrokerCore<T, P>) {
    this.id = id;
    this.#core = core;
    this.#core.registerClient(this);
  }

  /**
   * Subscribe to a topic with handler
   *
   * @param topic - Topic to subscribe to (e.g. 'user.login.v1')
   * @param handler - Message handler function
   * @param options - Subscription options (backpressure, replay)
   * @returns Unsubscribe function
   */
  on<K extends T>(
    topic: K,
    handler: HandlerFn<K, P[K]>,
    options?: SubscriptionOptions,
  ): () => void {
    if (!handler) {
      throw new Error('BrokerClient requires explicit handler function');
    }

    this.#core.subscribe(this.id, topic, handler as MessageHandler, options);

    return () => {
      this.#core.unsubscribe(this.id, topic);
    };
  }

  /**
   * Emit message to all subscribers (multicast)
   */
  async emit<K extends T>(topic: K, data: P[K], options?: MessageOptions): Promise<RoutingResult> {
    return this.#core.processMessage(topic, this.id, '*', data, options);
  }

  /**
   * Send request to specific client (unicast).
   *
   * The recipient's handler return value (if any) is captured in
   * `RoutingResult.data`. Caller specifies `R` to type that payload.
   * The broker does not enforce that the handler actually returns `R` —
   * the cast happens at the boundary, same trust level as `as R`.
   */
  async request<K extends T, R = unknown>(
    recipient: ClientID,
    topic: K,
    data: P[K],
    options?: MessageOptions,
  ): Promise<RoutingResult<R>> {
    return this.#core.processMessage<K, R>(topic, this.id, recipient, data, options);
  }

  /**
   * Unsubscribe from a topic
   */
  off<K extends T>(topic: K): void {
    this.#core.unsubscribe(this.id, topic);
  }

  /**
   * Reset client: clear all subscriptions and backpressure strategies
   * while keeping the client registered in the broker.
   *
   * After reset, the client can subscribe to messages again with fresh handlers.
   * Existing backpressure strategies are flushed and destroyed.
   */
  reset(): void {
    this.#core.resetClient(this.id);
  }

  /**
   * Destroy client and cleanup resources
   */
  destroy(): void {
    this.#core.unregisterClient(this.id);
  }
}
