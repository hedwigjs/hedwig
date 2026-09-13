import type { CartItem, TopicPayloads } from '@hedwig-demo/contracts';

import { useStateTopic } from '../clients/bus';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const EMPTY: Snapshot = { items: [] as CartItem[], totalItems: 0, totalPrice: 0, updatedAt: 0 };

/**
 * Read-only view onto the cart snapshot in the bus. Views use this instead
 * of holding their own state — the runtime (see cartStore.ts) is the SoT.
 *
 * `cart.snapshot.v1` is a `state` topic: `useStateTopic` subscribes before
 * paint and the runtime hands it the retained (last) snapshot synchronously,
 * so a late-mounted view shows the current cart on its first frame.
 *
 * `useStateTopic` here is the one from `clients/bus.ts`, pre-bound to the
 * shared `uiBus` client (`bindHooks`). Every mounted view registers its own
 * handler on it — the broker holds N handlers per (client, topic).
 */
export function useCartSnapshot(): Snapshot {
  return useStateTopic('cart.snapshot.v1', EMPTY);
}
