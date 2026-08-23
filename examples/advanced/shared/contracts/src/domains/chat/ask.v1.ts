import type { EventContract } from "../../lib/contract";

export default {
  name: "chat.ask.v1",
  description:
    "Request that the AI assistant compose a reply for `prompt`. A separate subscriber (see mfe/ai-chat/src/aiStreamAdapter.ts) turns this into whatever backend call is needed — SSE stream today, could be WebSocket/RPC tomorrow. Reply arrives asynchronously via `chat.reply-chunk.v1` × N and `chat.reply-completed.v1`, correlated by `replyId`.",
  payload: {} as { prompt: string; replyId: string },
  examples: {
    happy: {
      prompt: "Что порекомендуешь?",
      replyId: "r_mt5uw0k1_ab12",
    },
  },
} as const satisfies EventContract;
