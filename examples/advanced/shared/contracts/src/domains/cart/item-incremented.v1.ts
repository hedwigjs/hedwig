import type { EventContract } from "../../lib/contract";

export default {
  name: "cart.item-incremented.v1",
  description: "User bumped the quantity of an existing cart item by one.",
  payload: {} as { itemId: number },
  examples: {
    happy: { itemId: 8 },
  },
} as const satisfies EventContract;
