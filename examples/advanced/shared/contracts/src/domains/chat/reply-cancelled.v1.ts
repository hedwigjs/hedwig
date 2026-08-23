import type { EventContract } from "../../lib/contract";

export default {
  name: "chat.reply-cancelled.v1",
  description: "User pressed the stop button mid-stream; SSE connection was aborted, backend saw `res.on('close')` and ended generation.",
  payload: {} as { replyId: string },
  examples: {
    happy: { replyId: "r_mt4uu49z_36uf" },
  },
} as const satisfies EventContract;
