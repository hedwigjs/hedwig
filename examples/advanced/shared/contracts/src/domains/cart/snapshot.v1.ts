import type { TopicContract } from "../../lib/contract";
import type { CartItem } from "../../shared-types";

export default {
  name: "cart.snapshot.v1",
  kind: "state",
  retention: { last: 1 },
  description:
    "Full cart snapshot published by the cart runtime after every mutation. State topic: the runtime keeps the last snapshot and hands it to every new subscriber on `on()`. `updatedAt` (Unix ms, 0 for the empty boot state) lets cart stores in other tabs converge: a newer snapshot is adopted, an older one is answered with the current state.",
  payload: {} as { items: CartItem[]; totalItems: number; totalPrice: number; updatedAt: number },
  examples: {
    empty: { items: [], totalItems: 0, totalPrice: 0, updatedAt: 0 },
    two_items: {
      items: [
        { itemId: 8, name: "Хачапури по-аджарски", price: "890 ₽", quantity: 2 },
        { itemId: 5, name: "Хумус ливанский", price: "690 ₽", quantity: 1 },
      ],
      totalItems: 3,
      totalPrice: 2470,
      updatedAt: 1787431961281,
    },
  },
} as const satisfies TopicContract;
