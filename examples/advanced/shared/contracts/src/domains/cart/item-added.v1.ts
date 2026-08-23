import type { EventContract } from "../../lib/contract";

export default {
  name: "cart.item-added.v1",
  description: "User added a menu item to their cart (first-of-its-kind — for count changes see item-incremented).",
  payload: {} as { itemId: number; name: string; price: string },
  examples: {
    happy: { itemId: 8, name: "Хачапури по-аджарски", price: "890 ₽" },
    free_sample: { itemId: 99, name: "Free sample", price: "0 ₽" },
  },
} as const satisfies EventContract;
