import type { EventContract } from "../../lib/contract";

export default {
  name: "chat.reply-chunk.v1",
  description: "A single token/chunk of the AI reply arrived. Fires many times per reply — useful for devtools timeline, not for UI (UI streams directly from the SSE consumer).",
  payload: {} as { replyId: string; chunk: string },
  examples: {
    small: { replyId: "r_mt4uu49z_36uf", chunk: "При" },
    word: { replyId: "r_mt4uu49z_36uf", chunk: " Hedwig" },
  },
} as const satisfies EventContract;
