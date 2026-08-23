import type { EventContract } from "../../lib/contract";

export default {
  name: "cart.item-removed.v1",
  description: "Cart item removed outright (trash-icon click, or downstream of checkout-completed).",
  payload: {} as { itemId: number },
  examples: {
    happy: { itemId: 8 },
  },
} as const satisfies EventContract;
