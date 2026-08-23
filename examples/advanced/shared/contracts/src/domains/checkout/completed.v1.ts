import type { EventContract } from "../../lib/contract";
import type { CartItem } from "../../shared-types";

export default {
  name: "checkout.completed.v1",
  description: "Payment succeeded (iframe reported success via postMessage; checkout MFE rebroadcasts on the bus).",
  payload: {} as {
    orderId: string;
    status: string;
    totalPrice: number;
    items: CartItem[];
    acceptedAt: number;
  },
  examples: {
    accepted: {
      orderId: "A-MT4UU85D-UZJE",
      status: "accepted",
      totalPrice: 890,
      items: [{ itemId: 8, name: "Хачапури по-аджарски", price: "890 ₽", quantity: 1 }],
      acceptedAt: 1787431961281,
    },
  },
} as const satisfies EventContract;
