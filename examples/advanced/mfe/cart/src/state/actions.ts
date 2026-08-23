import type { CartItem } from '@hedwig-demo/contracts';
import { mockBus } from '@hedwig-demo/mock-bus';

export const cartActions = {
  increment(itemId: number): void {
    mockBus.emit('cart.item-incremented.v1', { itemId });
  },
  decrement(itemId: number): void {
    mockBus.emit('cart.item-decremented.v1', { itemId });
  },
  remove(itemId: number): void {
    mockBus.emit('cart.item-removed.v1', { itemId });
  },
  checkout(snapshot: { items: CartItem[]; totalPrice: number }): void {
    mockBus.emit('cart.checkout-requested.v1', snapshot);
  },
};
