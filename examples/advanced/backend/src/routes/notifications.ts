import type { Server as HttpServer } from 'node:http';
import type { Express, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';

type NotificationKind = 'success' | 'info' | 'warn' | 'error';

type NotificationPayload = {
  kind: NotificationKind;
  title: string;
  body?: string;
};

type Envelope = {
  topic: 'notification.show.v1';
  payload: NotificationPayload;
  ts: number;
};

const DEMO_NOTIFICATIONS: NotificationPayload[] = [
  {
    kind: 'success',
    title: 'Заказ #A-2041 в пути',
    body: 'Курьер будет через ~15 минут.',
  },
  {
    kind: 'info',
    title: 'Скидка 15% на мезе',
    body: 'До конца дня, промокод MEZE15.',
  },
  {
    kind: 'warn',
    title: 'Хачапури почти закончились',
    body: 'Осталось 3 порции на сегодня.',
  },
  {
    kind: 'info',
    title: 'Новое блюдо в меню',
    body: 'Попробуйте фалафель с ореховым соусом.',
  },
];

function envelope(payload: NotificationPayload): Envelope {
  return {
    topic: 'notification.show.v1',
    payload,
    ts: Date.now(),
  };
}

export function registerNotificationsRoutes(
  app: Express,
  server: HttpServer,
): void {
  const wss = new WebSocketServer({ server, path: '/ws/notifications' });

  const clients = new Set<WebSocket>();

  wss.on('connection', (socket) => {
    clients.add(socket);
    // eslint-disable-next-line no-console
    console.log(
      `[notifications] client connected (total=${clients.size})`,
    );

    socket.on('close', () => {
      clients.delete(socket);
      // eslint-disable-next-line no-console
      console.log(
        `[notifications] client disconnected (total=${clients.size})`,
      );
    });
  });

  function broadcast(payload: NotificationPayload): number {
    const message = JSON.stringify(envelope(payload));
    let sent = 0;
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        sent += 1;
      }
    }
    return sent;
  }

  // Автопуш случайного демо-уведомления каждые 25 секунд.
  const AUTO_PUSH_INTERVAL_MS = 25_000;
  setInterval(() => {
    if (clients.size === 0) return;
    const picked =
      DEMO_NOTIFICATIONS[Math.floor(Math.random() * DEMO_NOTIFICATIONS.length)]!;
    broadcast(picked);
  }, AUTO_PUSH_INTERVAL_MS);

  // POST /notify — dev-триггер. Тело: { kind?, title, body? } или пусто (тогда случайное).
  app.post('/notify', (req: Request, res: Response) => {
    const body = req.body ?? {};
    const payload: NotificationPayload =
      typeof body.title === 'string'
        ? {
            kind: (body.kind as NotificationKind) ?? 'info',
            title: body.title,
            body: typeof body.body === 'string' ? body.body : undefined,
          }
        : DEMO_NOTIFICATIONS[
            Math.floor(Math.random() * DEMO_NOTIFICATIONS.length)
          ]!;

    const sent = broadcast(payload);
    res.json({ ok: true, sent, payload });
  });
}
