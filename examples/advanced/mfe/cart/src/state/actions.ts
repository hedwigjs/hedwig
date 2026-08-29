import type { CartItem } from '@hedwig-demo/contracts';
import type {
  CartAddItemResponse,
  CartDecrementResponse,
  CartRemoveItemResponse,
  CheckoutStartResponse,
} from '@hedwig-demo/contracts';

import { uiBus } from '../clients/bus';

/**
 * Cart UI actions — targeted commands sent from the cart panel/pop-up to
 * the cart-runtime and checkout MFE. Every call is a **request**: sender
 * awaits an acknowledgement (`RoutingResult.data`), so failures are
 * observable and can drive UI feedback later.
 *
 * The cart-ui client emits these requests against the same contracts that
 * menu MFE uses — a single public API for cart mutation, regardless of
 * whether the click came from a product card or from the cart panel.
 */
export const cartActions = {
  increment(itemId: number): void {
    // Same contract as menu MFE's initial add — the runtime handles
    // "already present → +1" internally. Name/price are only used when
    // creating a new line; for an increment on an existing line the runtime
    // keeps its stored metadata, so empty strings are safe.
    void uiBus.request<'cart.add-item.v1', CartAddItemResponse>(
      'cart-runtime',
      'cart.add-item.v1',
      { itemId, name: '', price: '' },
    );
  },
  decrement(itemId: number): void {
    void uiBus.request<'cart.decrement.v1', CartDecrementResponse>(
      'cart-runtime',
      'cart.decrement.v1',
      { itemId },
    );
  },
  remove(itemId: number): void {
    void uiBus.request<'cart.remove-item.v1', CartRemoveItemResponse>(
      'cart-runtime',
      'cart.remove-item.v1',
      { itemId },
    );
  },
  checkout(snapshot: { items: CartItem[]; totalPrice: number }): void {
    void uiBus.request<'checkout.start.v1', CheckoutStartResponse>(
      'checkout',
      'checkout.start.v1',
      snapshot,
    );
  },
};
