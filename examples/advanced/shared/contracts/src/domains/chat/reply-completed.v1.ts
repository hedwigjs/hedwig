import type { TopicContract } from "../../lib/contract";

export default {
  name: "chat.reply-completed.v1",
  kind: "event",
  // Transcript topic: kept so a re-mounted chat view can replay the conversation.
  retention: { last: 50 },
  description: "AI assistant finished the reply cleanly (all chunks delivered, `done` SSE event received).",
  payload: {} as { replyId: string; fullText: string },
  examples: {
    short: {
      replyId: "r_mt4uu49z_36uf",
      fullText: "Привет! Я AI-консьерж Hedwig Café. Чем помочь?",
    },
  },
} as const satisfies TopicContract;
