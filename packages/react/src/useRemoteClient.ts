import { useRef, useState } from 'react';
import type { DependencyList } from 'react';
import { createRemoteClient } from '@hedwigjs/client';
import type { RemoteClient, RemoteClientOptions } from '@hedwigjs/client';
import { useIsoLayoutEffect } from './useClient';

/**
 * A remote client that lives exactly as long as the component — or as long
 * as `options` is truthy.
 *
 * `null` / `undefined` options mean "no remote right now" (the iframe has
 * not loaded, the socket is not there yet). The remote is (re)created when
 * `id`, the presence of options, or any of `deps` change, and destroyed on
 * cleanup: the transport is closed and pending requests resolve
 * `REMOTE_GONE`. Throws `RUNTIME_NOT_PROVIDED` from the effect when no
 * runtime exists — remotes need a live one.
 */
export function useRemoteClient(
  id: string,
  options: RemoteClientOptions | null | undefined,
  deps: DependencyList = [],
): RemoteClient | null {
  const [remote, setRemote] = useState<RemoteClient | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const present = options !== null && options !== undefined;

  useIsoLayoutEffect(() => {
    const current = optionsRef.current;
    if (!current) {
      setRemote(null);
      return;
    }
    const created = createRemoteClient(id, current);
    setRemote(created);
    return () => {
      created.destroy();
      setRemote((live) => (live === created ? null : live));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, present, ...deps]);

  return remote;
}
