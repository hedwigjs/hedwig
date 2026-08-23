import type { EventContract } from "../../lib/contract";

export default {
  name: "chat.message-sent.v1",
  description: "User sent a message to the AI assistant. Observability channel — nobody subscribes today except future devtools timeline.",
  observability: true,
  payload: {} as { id: string; text: string; at: number },
  examples: {
    happy: { id: "1a2b-3c4d", text: "Что порекомендуешь?", at: 1787431961281 },
    long: {
      id: "9x-yz",
      text: "Мы с семьёй хотим заказать ужин на четверых, бюджет до 3000₽, дети едят только курицу.",
      at: 1787431961500,
    },
  },
} as const satisfies EventContract;
