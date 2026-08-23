import type { EventContract } from "../../lib/contract";

export default {
  name: "ui.menu-item-closed.v1",
  description: "User closed the dish-details modal (via backdrop click, close button, or Escape). Pairs with menu-item-opened for time-in-modal metrics.",
  payload: {} as { itemId: number },
  examples: {
    happy: { itemId: 8 },
  },
} as const satisfies EventContract;
