import { useEffect, useLayoutEffect, useState } from 'react';
import { createClient } from '@hedwigjs/client';
import type { Client, ClientOptions, TopicContractsMap } from '@hedwigjs/client';

/** Layout effect on the client, plain effect where there is no DOM (SSR). */
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * A client that lives exactly as long as the component.
 *
 * Created in a layout effect (never during render — StrictMode renders
 * twice and two clients with one id would collide), destroyed in the
 * cleanup. The first render sees `null`; the client appears before paint.
 * A new `id` recreates it. `options` are read at creation.
 *
 * Pass the registry's `TopicContracts` as the third type parameter for
 * kind-aware `emit` / `request`.
 */
export function useClient<
  T extends string = string,
  P extends Record<T, any> = any,
  C extends TopicContractsMap<T> = TopicContractsMap<T>,
>(id: string, options?: ClientOptions): Client<T, P, C> | null {
  const [client, setClient] = useState<Client<T, P, C> | null>(null);
  const [optionsAtCreate] = useState(options);

  useIsoLayoutEffect(() => {
    const created = createClient<T, P, C>(id, optionsAtCreate);
    setClient(created);
    return () => {
      created.destroy();
      setClient((current) => (current === created ? null : current));
    };
  }, [id, optionsAtCreate]);

  return client;
}
