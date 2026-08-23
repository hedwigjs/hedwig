import { useEffect, useState } from 'react';

import type { CartItem, TopicPayloads } from '@hedwig-demo/contracts';
import { mockBus } from '@hedwig-demo/mock-bus';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const EMPTY: Snapshot = { items: [] as CartItem[], totalItems: 0, totalPrice: 0 };

/**
 * Read-only view onto the cart snapshot in the bus. Views use this instead
 * of holding their own state — the runtime (see cartStore.ts) is the SoT.
 */
export function useCartSnapshot(): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    return mockBus.on('cart.snapshot.v1', setSnapshot, { replay: true });
  }, []);

  return snapshot;
}
