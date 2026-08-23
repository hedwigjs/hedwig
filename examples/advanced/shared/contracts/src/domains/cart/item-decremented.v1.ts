import type { EventContract } from "../../lib/contract";

export default {
  name: "cart.item-decremented.v1",
  description: "User dropped the quantity of an existing cart item by one; cart runtime removes the item at quantity 0.",
  payload: {} as { itemId: number },
  examples: {
    happy: { itemId: 8 },
  },
} as const satisfies EventContract;
