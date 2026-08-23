import type { EventContract } from "../../lib/contract";
import type { CartItem } from "../../shared-types";

export default {
  name: "cart.snapshot.v1",
  description: "Full cart snapshot published by the cart runtime after every mutation. Late subscribers use `replay: true` to receive the last snapshot on subscribe.",
  payload: {} as { items: CartItem[]; totalItems: number; totalPrice: number },
  examples: {
    empty: { items: [], totalItems: 0, totalPrice: 0 },
    two_items: {
      items: [
        { itemId: 8, name: "Хачапури по-аджарски", price: "890 ₽", quantity: 2 },
        { itemId: 5, name: "Хумус ливанский", price: "690 ₽", quantity: 1 },
      ],
      totalItems: 3,
      totalPrice: 2470,
    },
  },
} as const satisfies EventContract;
