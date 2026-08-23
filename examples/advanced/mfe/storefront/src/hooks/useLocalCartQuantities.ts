import { useCallback, useEffect, useState } from 'react';

import type { MenuItem } from '@hedwig-demo/contracts';
import { mockBus } from '@hedwig-demo/mock-bus';

/**
 * Storefront's read-only view of cart quantities.
 *
 * The cart MFE is the single source of truth for cart state — storefront
 * derives its per-item counters from `cart.snapshot.v1` and never mutates
 * its own copy directly. Clicks only publish commands; the resulting
 * snapshot from cart is what updates the UI.
 *
 * `{ replay: true }` handles the late-joiner case: if cart already has
 * items when storefront mounts, mockBus fires the last cached snapshot
 * on subscribe.
 */
export function useLocalCartQuantities() {
  const [qtyById, setQtyById] = useState<Record<number, number>>({});

  useEffect(() => {
    return mockBus.on(
      'cart.snapshot.v1',
      (snapshot) => {
        const next: Record<number, number> = {};
        for (const item of snapshot.items) {
          next[item.itemId] = item.quantity;
        }
        setQtyById(next);
      },
      { replay: true },
    );
  }, []);

  const getQty = useCallback((id: number) => qtyById[id] ?? 0, [qtyById]);

  const addFirst = useCallback((item: MenuItem) => {
    mockBus.emit('cart.item-added.v1', {
      itemId: item.id,
      name: item.name,
      price: item.price,
    });
  }, []);

  const increment = useCallback((id: number) => {
    mockBus.emit('cart.item-incremented.v1', { itemId: id });
  }, []);

  const decrement = useCallback((id: number) => {
    mockBus.emit('cart.item-decremented.v1', { itemId: id });
  }, []);

  return { getQty, addFirst, increment, decrement };
}
