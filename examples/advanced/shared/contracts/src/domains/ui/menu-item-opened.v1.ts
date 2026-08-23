import type { EventContract } from "../../lib/contract";
import type { MenuItem } from "../../shared-types";

export default {
  name: "ui.menu-item-opened.v1",
  description: "User opened the dish-details modal from a menu card. UI-observability channel — no subscribers today.",
  payload: {} as { item: MenuItem },
  examples: {
    happy: {
      item: {
        id: 8,
        name: "Хачапури по-аджарски",
        price: "890 ₽",
        previewUrl: "https://eda.yandex/images/3506804/65481d8feb3a0d8c6fd076aeac47f0ae-400x400.jpeg",
        description: "Лодочка из теста с сыром сулугуни, яйцом и маслом.",
        nutrition: { caloriesKcal: 620, proteinG: 28, fatG: 38, carbsG: 42 },
      },
    },
  },
} as const satisfies EventContract;
