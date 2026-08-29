import type { EventContract } from "../../lib/contract";

/**
 * Response returned by the cart runtime handler.
 * `quantity` reflects the state after the decrement — 0 means the line was
 * fully removed (last unit dropped).
 */
export type CartDecrementResponse = {
  itemId: number;
  quantity: number;
  subtotal: number;
};

export default {
  name: "cart.decrement.v1",
  description:
    "Command: decrement one unit of an existing cart line. Handled by cart-runtime as a request. If the current quantity is 1, the line is fully removed and the response reports quantity=0.",
  payload: {} as { itemId: number },
  examples: {
    single_unit: { itemId: 8 },
  },
} as const satisfies EventContract;
