/**
 * @hedwigjs/vue
 *
 * Composables that bind Hedwig clients to the component scope. Built on
 * `@hedwigjs/client`; no dependency on the runtime.
 *
 *   - `useClient(id)`               — a client for the scope's lifetime
 *   - `useTopic(client, topic, fn)`  — subscribe while the scope lives
 *   - `useStateTopic(client, topic)` — the retained value of a state topic, as a ref
 *   - `useRequest(client, to, topic)`— `send()` + `pending` / `result` refs, answer typed by the contract
 *   - `useRemoteClient(id, opts)`    — a remote client that follows a reactive options source
 *   - `useRuntimeReady()`            — whether the host's runtime is there yet
 *   - `bindComposables(client)`      — the three data composables with the client filled in
 */

import { onScopeDispose, ref, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref, ShallowRef } from 'vue';
import { createClient, createRemoteClient, getRuntimeInfo, whenRuntimeReady, RoutingReason } from '@hedwigjs/client';
import type {
  Client,
  ClientOptions,
  HandlerFn,
  RemoteClient,
  RemoteClientOptions,
  RequestOptions,
  RequestTopic,
  ResponseOf,
  RoutingResult,
  SubscriptionOptions,
  TopicContractsMap,
} from '@hedwigjs/client';

/**
 * A client that lives exactly as long as the current scope (component or
 * `effectScope`). Created synchronously in setup, so it is usable right
 * away; destroyed on scope dispose.
 */
export function useClient<
  T extends string = string,
  P extends Record<T, any> = any,
  C extends TopicContractsMap<T> = TopicContractsMap<T>,
>(id: string, options?: ClientOptions): Client<T, P, C> {
  const client = createClient<T, P, C>(id, options);
  onScopeDispose(() => client.destroy());
  return client;
}

type ClientSource<T extends string, P extends Record<T, any>, C extends TopicContractsMap<T>> = MaybeRefOrGetter<
  Client<T, P, C> | null | undefined
>;

/**
 * Subscribe for as long as the scope lives. `client` may be a plain
 * client, a ref, or a getter; the subscription follows it. The handler is
 * called through a stable wrapper, so replacing it never re-subscribes.
 */
export function useTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(client: ClientSource<T, P, C>, topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): void {
  let latest = handler;
  watch(
    () => toValue(client) ?? null,
    (current, _previous, onCleanup) => {
      if (!current) return;
      const off = current.on(topic, (message) => latest(message), options);
      onCleanup(off);
    },
    { immediate: true },
  );
  // Keep the wrapper pointing at the handler passed on the last call in
  // this scope (relevant when the composable is invoked inside a watcher).
  latest = handler;
}

/**
 * The current value of a `state` topic as a shallow ref. The runtime hands
 * the retained value to a new subscriber synchronously, so the ref holds it
 * as soon as the composable returns.
 */
export function useStateTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(client: ClientSource<T, P, C>, topic: K, initial: P[K]): ShallowRef<P[K]>;
export function useStateTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(client: ClientSource<T, P, C>, topic: K): ShallowRef<P[K] | undefined>;
export function useStateTopic<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T,
>(client: ClientSource<T, P, C>, topic: K, initial?: P[K]): ShallowRef<P[K] | undefined> {
  const value = shallowRef<P[K] | undefined>(initial);
  useTopic(client, topic, (message) => {
    value.value = message.data;
  });
  return value;
}

export interface RequestHandle<D, R> {
  /** Send the request. Resolves with the result; never rejects. */
  send(data: D): Promise<RoutingResult<R>>;
  /** True while at least one send is in flight. */
  pending: Ref<boolean>;
  /** The last settled result, `null` before the first send or after `reset()`. */
  result: ShallowRef<RoutingResult<R> | null>;
  reset(): void;
}

function notReady<R>(): RoutingResult<R> {
  return Object.freeze({
    status: 'NACK' as const,
    reason: RoutingReason.RUNTIME_NOT_READY,
    message: 'useRequest: no client to send with',
    timestamp: Date.now(),
  });
}

/**
 * A request bound to the scope: `send(data)` plus `pending` / `result`
 * refs, with the answer type inferred from the contract.
 */
export function useRequest<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T & RequestTopic<T, C>,
  R = ResponseOf<C, K>,
>(client: ClientSource<T, P, C>, recipient: string, topic: K, options?: RequestOptions): RequestHandle<P[K], R> {
  const inFlight = ref(0);
  const pending = ref(false);
  const result = shallowRef<RoutingResult<R> | null>(null);
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  async function send(data: P[K]): Promise<RoutingResult<R>> {
    const current = toValue(client);
    if (!current) return notReady<R>();
    inFlight.value += 1;
    pending.value = true;
    try {
      const settled = await current.request<K, R>(recipient, topic, data, options);
      if (!disposed) result.value = settled;
      return settled;
    } finally {
      inFlight.value -= 1;
      pending.value = inFlight.value > 0;
    }
  }

  return {
    send,
    pending,
    result,
    reset: () => {
      result.value = null;
    },
  };
}

/**
 * A remote client that follows a reactive options source: created when the
 * source yields options, destroyed (transport closed, pending requests
 * `REMOTE_GONE`) when it yields `null` / `undefined`, when it changes, or
 * when the scope is disposed.
 */
export function useRemoteClient(
  id: string,
  options: MaybeRefOrGetter<RemoteClientOptions | null | undefined>,
): ShallowRef<RemoteClient | null> {
  const remote = shallowRef<RemoteClient | null>(null);
  watch(
    () => toValue(options) ?? null,
    (current, _previous, onCleanup) => {
      if (!current) {
        remote.value = null;
        return;
      }
      const created = createRemoteClient(id, current);
      remote.value = created;
      onCleanup(() => {
        created.destroy();
        if (remote.value === created) remote.value = null;
      });
    },
    { immediate: true },
  );
  return remote;
}

/** `true` once a usable Hedwig runtime exists in this realm. */
export function useRuntimeReady(): Ref<boolean> {
  const ready = ref(getRuntimeInfo() !== null);
  if (!ready.value) {
    let alive = true;
    onScopeDispose(() => {
      alive = false;
    });
    whenRuntimeReady().then(
      () => {
        if (alive) ready.value = true;
      },
      () => {},
    );
  }
  return ready;
}

/**
 * The data composables with the client already filled in. Produced by
 * `bindComposables(client)`.
 */
export interface BoundComposables<T extends string, P extends Record<T, any>, C extends TopicContractsMap<T>> {
  /** The client every composable here is bound to. */
  readonly client: Client<T, P, C>;
  useTopic<K extends T>(topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): void;
  useStateTopic<K extends T>(topic: K, initial: P[K]): ShallowRef<P[K]>;
  useStateTopic<K extends T>(topic: K): ShallowRef<P[K] | undefined>;
  useRequest<K extends T & RequestTopic<T, C>>(
    recipient: string,
    topic: K,
    options?: RequestOptions,
  ): RequestHandle<P[K], ResponseOf<C, K>>;
}

/**
 * Bind the composables to one client, once, at module scope — then
 * components call `useStateTopic('cart.snapshot.v1')` instead of passing
 * the client each time. Partial application: the client lives in a
 * closure, the signatures lose their first argument, the types stay.
 *
 * ```ts
 * // clients/bus.ts
 * export const bus = createClient<Topic, TopicPayloads, TopicContracts>('menu');
 * export const { useStateTopic, useTopic, useRequest } = bindComposables(bus);
 * ```
 *
 * Meant for module-scope clients. A client owned by a component
 * (`useClient`) is per scope — keep passing it to the unbound composables.
 */
export function bindComposables<T extends string, P extends Record<T, any>, C extends TopicContractsMap<T>>(
  client: Client<T, P, C>,
): BoundComposables<T, P, C> {
  const useBoundStateTopic = <K extends T>(topic: K, initial?: P[K]) => useStateTopic(client, topic, initial as P[K]);
  return {
    client,
    useTopic: (topic, handler, options) => useTopic(client, topic, handler, options),
    useStateTopic: useBoundStateTopic as BoundComposables<T, P, C>['useStateTopic'],
    useRequest: (recipient, topic, options) => useRequest(client, recipient, topic, options),
  };
}
