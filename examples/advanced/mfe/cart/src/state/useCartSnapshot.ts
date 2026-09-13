import { useEffect, useState } from 'react';

import type { CartItem, TopicPayloads } from '@hedwig-demo/contracts';

import { uiBus } from '../clients/bus';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const EMPTY: Snapshot = { items: [] as CartItem[], totalItems: 0, totalPrice: 0 };

/**
 * Read-only view onto the cart snapshot in the bus. Views use this instead
 * of holding their own state — the runtime (see cartStore.ts) is the SoT.
 *
 * `cart.snapshot.v1` is a `state` topic: the runtime hands the retained
 * (last) snapshot to the handler synchronously inside `on()`, so a
 * late-mounted view shows the current cart on mount, not an empty state
 * until the next mutation. Nothing to ask for at the call site.
 *
 * Every mounted view registers its own handler on the shared `uiBus` client
 * — the broker holds N handlers per (client, topic) so this scales.
 */
export function useCartSnapshot(): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    return uiBus.on('cart.snapshot.v1', (msg) => setSnapshot(msg.data));
  }, []);

  return snapshot;
}
