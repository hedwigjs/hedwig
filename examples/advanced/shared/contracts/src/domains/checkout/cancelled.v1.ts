import type { EventContract } from "../../lib/contract";

export default {
  name: "checkout.cancelled.v1",
  description: "User closed the checkout modal without paying. `reason` narrow-typed for now; expect to grow (`timeout`, `iframe-error`).",
  payload: {} as { reason: "user-closed" },
  examples: {
    user_closed: { reason: "user-closed" },
  },
} as const satisfies EventContract;
