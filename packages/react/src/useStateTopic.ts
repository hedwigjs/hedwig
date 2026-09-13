import { useState } from 'react';
import type { Client, TopicContractsMap } from '@hedwigjs/client';
import { useTopic } from './useTopic';

/**
 * The current value of a `state` topic (or the last event on any topic).
 *
 * The runtime hands a state topic's retained value to a new subscriber
 * synchronously inside `on()`; the subscription happens in a layout
 * effect, so the value is set before the first paint — no flash of
 * `initial`. That holds when the runtime is already there at mount. A
 * module-scope client created before `initBroker()` is a lazy client:
 * its subscription binds when the runtime appears, and the value lands
 * then — after the first paint. Later emits update it either way.
 */
export function useStateTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(client: Client<T, P, C> | null, topic: K, initial: P[K]): P[K];
export function useStateTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(client: Client<T, P, C> | null, topic: K): P[K] | undefined;
export function useStateTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(client: Client<T, P, C> | null, topic: K, initial?: P[K]): P[K] | undefined {
  const [value, setValue] = useState<P[K] | undefined>(initial);
  useTopic(client, topic, (message) => setValue(message.data));
  return value;
}
