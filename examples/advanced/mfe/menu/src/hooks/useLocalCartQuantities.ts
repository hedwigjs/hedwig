import { useCallback, useMemo } from 'react';

import { useStateTopic } from '@hedwigjs/react';

import type { MenuItem } from '@hedwig-demo/contracts';
import type {
  CartAddItemResponse,
  CartDecrementResponse,
} from '@hedwig-demo/contracts';

import { bus } from '../clients/bus';

/**
 * Menu MFE's read-only view of cart quantities.
 *
 * The cart MFE owns state and exposes it as a broadcast `cart.snapshot.v1`
 * (a `state` topic — the runtime keeps the last one). The menu MFE:
 *   1. Subscribes to snapshots — that's the ONLY channel it needs to render
 *      per-item quantities on dish cards. No item-added/removed events
 *      are listened to — full state is delivered on every mutation.
 *   2. Sends **requests** to the cart-store for mutations. `add-item`
 *      handles both first-add and increment (runtime returns updated qty).
 *
 * `useStateTopic` subscribes before paint and the retained snapshot arrives
 * synchronously inside `on()`, so a menu that mounts after items were added
 * shows the right quantities on its first frame.
 */
export function useLocalCartQuantities() {
  const snapshot = useStateTopic(bus, 'cart.snapshot.v1');
  const qtyById = useMemo(() => {
    const next: Record<number, number> = {};
    for (const item of snapshot?.items ?? []) {
      next[item.itemId] = item.quantity;
    }
    return next;
  }, [snapshot]);

  const getQty = useCallback((id: number) => qtyById[id] ?? 0, [qtyById]);

  const addOrIncrement = useCallback((item: MenuItem) => {
    // Same request whether the item is new or already there — cart runtime
    // treats "already present" as an increment.
    void bus.request<'cart.add-item.v1', CartAddItemResponse>(
      'cart-store',
      'cart.add-item.v1',
      { itemId: item.id, name: item.name, price: item.price },
    );
  }, []);

  const decrement = useCallback((id: number) => {
    void bus.request<'cart.decrement.v1', CartDecrementResponse>(
      'cart-store',
      'cart.decrement.v1',
      { itemId: id },
    );
  }, []);

  // `addFirst` and `increment` collapse into the same call — kept as two
  // named callbacks so existing menu components don't need to change.
  return {
    getQty,
    addFirst: addOrIncrement,
    increment: (id: number) => {
      // Menu cards only call `increment` when the item is already in the
      // cart, which means we know its metadata from the snapshot. Look it
      // up from React state; if it's somehow gone, no-op.
      const price = ''; // metadata not needed for existing lines — runtime ignores name/price when line exists
      void bus.request<'cart.add-item.v1', CartAddItemResponse>(
        'cart-store',
        'cart.add-item.v1',
        { itemId: id, name: '', price },
      );
    },
    decrement,
  };
}
