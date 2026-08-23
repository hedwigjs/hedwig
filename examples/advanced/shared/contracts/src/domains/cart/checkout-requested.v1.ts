import type { EventContract } from "../../lib/contract";
import type { CartItem } from "../../shared-types";

export default {
  name: "cart.checkout-requested.v1",
  description: "User pressed 'Оформить заказ' — cart hands off current items to whoever owns the checkout flow (the checkout MFE in this demo).",
  payload: {} as { items: CartItem[]; totalPrice: number },
  examples: {
    single_item: {
      items: [{ itemId: 8, name: "Хачапури по-аджарски", price: "890 ₽", quantity: 1 }],
      totalPrice: 890,
    },
  },
} as const satisfies EventContract;
