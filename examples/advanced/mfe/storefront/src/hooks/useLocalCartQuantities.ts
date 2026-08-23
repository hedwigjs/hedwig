import { useCallback, useEffect, useState } from 'react';

import type { MenuItem } from '@hedwig-demo/contracts';

import { bus } from '../clients/bus';

/**
 * Storefront's read-only view of cart quantities.
 *
 * The cart MFE is the single source of truth for cart state — storefront
 * derives its per-item counters from `cart.snapshot.v1` and never mutates
 * its own copy directly. Clicks only publish commands; the resulting
 * snapshot from cart is what updates the UI.
 *
 * `replay: { limit: 1 }` handles the late-joiner case: if cart already has
 * items when storefront mounts, the broker fires the handler once with the
 * last snapshot recorded in history (cart runtime emits snapshots with
 * `{ history: true }`).
 */
export function useLocalCartQuantities() {
  const [qtyById, setQtyById] = useState<Record<number, number>>({});

  useEffect(() => {
    return bus.on(
      'cart.snapshot.v1',
      (msg) => {
        const next: Record<number, number> = {};
        for (const item of msg.data.items) {
          next[item.itemId] = item.quantity;
        }
        setQtyById(next);
      },
      { replay: { limit: 1 } },
    );
  }, []);

  const getQty = useCallback((id: number) => qtyById[id] ?? 0, [qtyById]);

  const addFirst = useCallback((item: MenuItem) => {
    void bus.emit('cart.item-added.v1', {
      itemId: item.id,
      name: item.name,
      price: item.price,
    });
  }, []);

  const increment = useCallback((id: number) => {
    void bus.emit('cart.item-incremented.v1', { itemId: id });
  }, []);

  const decrement = useCallback((id: number) => {
    void bus.emit('cart.item-decremented.v1', { itemId: id });
  }, []);

  return { getQty, addFirst, increment, decrement };
}
