import { useEffect, useState } from 'react';
import { getRuntimeInfo, whenRuntimeReady } from '@hedwigjs/client';

/**
 * `true` once a usable Hedwig runtime exists in this realm. Handy for
 * gating `useRemoteClient` in a module that may mount before the host
 * called `initBroker()`.
 */
export function useRuntimeReady(): boolean {
  const [ready, setReady] = useState(() => getRuntimeInfo() !== null);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    whenRuntimeReady().then(
      () => {
        if (alive) setReady(true);
      },
      () => {
        // RUNTIME_TOO_OLD: stays not-ready; the SDK already threw for callers.
      },
    );
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}
