import type { EventContract } from "../../lib/contract";

/**
 * Response returned by the cart runtime handler.
 * The request pattern: sender receives the resulting cart line via
 * `RoutingResult.data`. Sender types the call site with this shape.
 */
export type CartAddItemResponse = {
  itemId: number;
  quantity: number;
  subtotal: number;
};

export default {
  name: "cart.add-item.v1",
  description:
    "Command: add product to cart. Handled by cart-runtime as a request — if the item is already there, its quantity is incremented. Returns the resulting line quantity and running subtotal.",
  payload: {} as { itemId: number; name: string; price: string },
  examples: {
    happy: { itemId: 8, name: "Хачапури по-аджарски", price: "890 ₽" },
    free_sample: { itemId: 99, name: "Free sample", price: "0 ₽" },
  },
} as const satisfies EventContract;
