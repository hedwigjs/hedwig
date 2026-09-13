import type {
  Client,
  HandlerFn,
  RequestOptions,
  RequestTopic,
  ResponseOf,
  SubscriptionOptions,
  TopicContractsMap,
} from '@hedwigjs/client';
import { useTopic } from './useTopic';
import { useStateTopic } from './useStateTopic';
import { useRequest } from './useRequest';
import type { RequestHandle } from './useRequest';

/**
 * The hooks of this package with the client already filled in. Produced by
 * `bindHooks(client)`; every member is a real hook and follows the rules
 * of hooks.
 */
export interface BoundHooks<T extends string, P extends Record<T, any>, C extends TopicContractsMap<T>> {
  /** The client every hook here is bound to. */
  readonly client: Client<T, P, C>;
  /** `useTopic(topic, handler, options?)` — see `useTopic`. */
  useTopic<K extends T>(topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): void;
  /** `useStateTopic(topic, initial?)` — see `useStateTopic`. */
  useStateTopic<K extends T>(topic: K, initial: P[K]): P[K];
  useStateTopic<K extends T>(topic: K): P[K] | undefined;
  /** `useRequest(recipient, topic, options?)` — see `useRequest`; the answer type comes from the contract. */
  useRequest<K extends T & RequestTopic<T, C>>(
    recipient: string,
    topic: K,
    options?: RequestOptions,
  ): RequestHandle<P[K], ResponseOf<C, K>>;
}

/**
 * Bind the hooks to one client, once, at module scope — then components
 * call `useStateTopic('cart.snapshot.v1')` instead of passing the client
 * to every hook. Plain partial application: the client lives in a
 * closure, the signatures lose their first argument, the types stay.
 *
 * ```ts
 * // clients/bus.ts
 * export const bus = createClient<Topic, TopicPayloads, TopicContracts>('menu');
 * export const { useStateTopic, useTopic, useRequest } = bindHooks(bus);
 *
 * // any component
 * const snapshot = useStateTopic('cart.snapshot.v1');
 * ```
 *
 * Meant for module-scope clients (`createClient` from `@hedwigjs/client`
 * works before the runtime is there). A client owned by a component
 * (`useClient`) changes identity with the component, so keep passing it
 * to the unbound hooks in that case.
 */
export function bindHooks<T extends string, P extends Record<T, any>, C extends TopicContractsMap<T>>(
  client: Client<T, P, C>,
): BoundHooks<T, P, C> {
  const useBoundStateTopic = <K extends T>(topic: K, initial?: P[K]) => useStateTopic(client, topic, initial as P[K]);
  return {
    client,
    useTopic: (topic, handler, options) => useTopic(client, topic, handler, options),
    useStateTopic: useBoundStateTopic as BoundHooks<T, P, C>['useStateTopic'],
    useRequest: (recipient, topic, options) => useRequest(client, recipient, topic, options),
  };
}
