import { useRef } from 'react';
import type { Client, HandlerFn, SubscriptionOptions, TopicContractsMap } from '@hedwigjs/client';
import { useIsoLayoutEffect } from './useClient';

/**
 * Subscribe a component to a topic for as long as it is mounted.
 *
 * The latest `handler` is always the one called — no stale closures, no
 * re-subscribe when it changes. The subscription is (re)made when `client`
 * or `topic` change; `options` are read at subscribe time. Runs as a
 * layout effect, so a `state` topic's retained value reaches the handler
 * before the first paint — when the runtime is already there; a lazy
 * client delivers it when it binds.
 *
 * A subscription denied by an `onSubscribe` hook throws from the effect;
 * catch it with an error boundary or check the policy first.
 */
export function useTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(
  client: Client<T, P, C> | null,
  topic: K,
  handler: HandlerFn<K, P[K]>,
  options?: SubscriptionOptions,
): void {
  const handlerRef = useRef(handler);
  const optionsRef = useRef(options);
  handlerRef.current = handler;
  optionsRef.current = options;

  useIsoLayoutEffect(() => {
    if (!client) return;
    return client.on(topic, (message) => handlerRef.current(message), optionsRef.current);
  }, [client, topic]);
}
