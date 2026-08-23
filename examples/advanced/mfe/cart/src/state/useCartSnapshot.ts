import { useEffect, useState } from 'react';

import type { CartItem, TopicPayloads } from '@hedwig-demo/contracts';

import { uiBus } from '../clients/bus';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const EMPTY: Snapshot = { items: [] as CartItem[], totalItems: 0, totalPrice: 0 };

/**
 * Read-only view onto the cart snapshot in the bus. Views use this instead
 * of holding their own state — the runtime (see cartStore.ts) is the SoT.
 *
 * `replay: { limit: 1 }` asks the broker to fire the handler once with the
 * most recent snapshot from history (recorded via `emit(..., { history: true })`
 * in cartStore). Guarantees late-mounted views show the current cart on
 * mount, not an empty state until the next mutation.
 *
 * Every mounted view registers its own handler on the shared `uiBus` client
 * — the broker holds N handlers per (client, topic) so this scales.
 */
export function useCartSnapshot(): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    return uiBus.on(
      'cart.snapshot.v1',
      (msg) => setSnapshot(msg.data),
      { replay: { limit: 1 } },
    );
  }, []);

  return snapshot;
}
