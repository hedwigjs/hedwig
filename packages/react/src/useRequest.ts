import { useCallback, useEffect, useRef, useState } from 'react';
import { RoutingReason } from '@hedwigjs/client';
import type {
  Client,
  RequestOptions,
  RequestTopic,
  ResponseOf,
  RoutingResult,
  TopicContractsMap,
} from '@hedwigjs/client';

export interface RequestHandle<D, R> {
  /** Send the request. Resolves with the result; never rejects. */
  send(data: D): Promise<RoutingResult<R>>;
  /** True while at least one send is in flight. */
  pending: boolean;
  /** The last settled result, `null` before the first send or after `reset()`. */
  result: RoutingResult<R> | null;
  reset(): void;
}

function notMounted<R>(): RoutingResult<R> {
  return Object.freeze({
    status: 'NACK' as const,
    reason: RoutingReason.RUNTIME_NOT_READY,
    message: 'useRequest: the client is not mounted yet',
    timestamp: Date.now(),
  });
}

/**
 * A request bound to a component: `send(data)` plus `pending` / `result`
 * state, with the answer type inferred from the contract. Results that
 * arrive after unmount are dropped instead of touching state.
 */
export function useRequest<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T>,
  K extends T & RequestTopic<T, C>,
  R = ResponseOf<C, K>,
>(client: Client<T, P, C> | null, recipient: string, topic: K, options?: RequestOptions): RequestHandle<P[K], R> {
  const [inFlight, setInFlight] = useState(0);
  const [result, setResult] = useState<RoutingResult<R> | null>(null);
  const clientRef = useRef(client);
  const optionsRef = useRef(options);
  const mounted = useRef(true);
  clientRef.current = client;
  optionsRef.current = options;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = useCallback(
    async (data: P[K]): Promise<RoutingResult<R>> => {
      const current = clientRef.current;
      if (!current) return notMounted<R>();
      setInFlight((n) => n + 1);
      try {
        const settled = await current.request<K, R>(recipient, topic, data, optionsRef.current);
        if (mounted.current) setResult(settled);
        return settled;
      } finally {
        if (mounted.current) setInFlight((n) => n - 1);
      }
    },
    [recipient, topic],
  );

  const reset = useCallback(() => setResult(null), []);

  return { send, pending: inFlight > 0, result, reset };
}
