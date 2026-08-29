import type { EventContract } from "../../lib/contract";

/**
 * Response returned by the cart runtime handler. `removed` is `false` when
 * the line was not present to begin with (idempotent no-op).
 */
export type CartRemoveItemResponse = {
  itemId: number;
  removed: boolean;
  subtotal: number;
};

export default {
  name: "cart.remove-item.v1",
  description:
    "Command: fully remove a line from the cart regardless of quantity. Handled by cart-runtime as a request.",
  payload: {} as { itemId: number },
  examples: {
    happy: { itemId: 8 },
  },
} as const satisfies EventContract;
