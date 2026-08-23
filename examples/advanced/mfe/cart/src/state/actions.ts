import type { CartItem } from '@hedwig-demo/contracts';

import { uiBus } from '../clients/bus';

export const cartActions = {
  increment(itemId: number): void {
    void uiBus.emit('cart.item-incremented.v1', { itemId });
  },
  decrement(itemId: number): void {
    void uiBus.emit('cart.item-decremented.v1', { itemId });
  },
  remove(itemId: number): void {
    void uiBus.emit('cart.item-removed.v1', { itemId });
  },
  checkout(snapshot: { items: CartItem[]; totalPrice: number }): void {
    void uiBus.emit('cart.checkout-requested.v1', snapshot);
  },
};
