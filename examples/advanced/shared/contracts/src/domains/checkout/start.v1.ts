import type { EventContract } from "../../lib/contract";
import type { CartItem } from "../../shared-types";

/**
 * Response returned by the checkout MFE handler when it accepts the cart
 * for processing. `ready` is a synchronous acknowledgement — the checkout
 * modal is already opened by the time this resolves.
 */
export type CheckoutStartResponse = {
  sessionId: string;
  ready: true;
};

export default {
  name: "checkout.start.v1",
  description:
    "Command: hand off the current cart to the checkout MFE. Handled as a request — cart waits for the checkout to confirm the modal opened and a session id was minted before returning control to the user.",
  payload: {} as { items: CartItem[]; totalPrice: number },
  examples: {
    single_item: {
      items: [
        { itemId: 8, name: "Хачапури по-аджарски", price: "890 ₽", quantity: 1 },
      ],
      totalPrice: 890,
    },
  },
} as const satisfies EventContract;
