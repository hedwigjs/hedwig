import type { EventContract } from "../../lib/contract";

export default {
  name: "chat.reply-started.v1",
  description: "AI assistant started composing a reply (first `chunk` is about to arrive). Observability trace so devtools can time TTFB.",
  observability: true,
  payload: {} as { replyId: string; inReplyTo: string },
  examples: {
    happy: { replyId: "r_mt4uu49z_36uf", inReplyTo: "1a2b-3c4d" },
  },
} as const satisfies EventContract;
