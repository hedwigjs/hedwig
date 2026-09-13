import { useStateTopic } from '@hedwigjs/react';
import type { CartItem, TopicPayloads } from '@hedwig-demo/contracts';

import { uiBus } from '../clients/bus';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const EMPTY: Snapshot = { items: [] as CartItem[], totalItems: 0, totalPrice: 0 };

/**
 * Read-only view onto the cart snapshot in the bus. Views use this instead
 * of holding their own state — the runtime (see cartStore.ts) is the SoT.
 *
 * `cart.snapshot.v1` is a `state` topic: `useStateTopic` subscribes before
 * paint and the runtime hands it the retained (last) snapshot synchronously,
 * so a late-mounted view shows the current cart on its first frame.
 *
 * Every mounted view registers its own handler on the shared `uiBus` client
 * — the broker holds N handlers per (client, topic) so this scales.
 */
export function useCartSnapshot(): Snapshot {
  return useStateTopic(uiBus, 'cart.snapshot.v1', EMPTY);
}
