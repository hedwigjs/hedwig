import type { EventContract } from "../../lib/contract";
import type { NotificationKind } from "../../shared-types";

export default {
  name: "notification.show.v1",
  description: "Push a toast to the notification panel. Publishers: backend WS-bridge in notifications MFE, checkout MFE (order-accepted), anyone else who wants to notify the user.",
  payload: {} as { kind: NotificationKind; title: string; body?: string },
  examples: {
    order_ready: { kind: "success", title: "Заказ #A-2041 в пути", body: "Курьер будет через ~15 минут." },
    stock_warn: { kind: "warn", title: "Хачапури почти закончились", body: "Осталось 3 порции на сегодня." },
    promo: { kind: "info", title: "Скидка 15% на мезе", body: "До конца дня, промокод MEZE15." },
    payment_failed: { kind: "error", title: "Оплата не прошла", body: "Проверьте карту и попробуйте снова." },
  },
} as const satisfies EventContract;
