import type { Server as HttpServer } from 'node:http';
import type { Express, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';

type NotificationKind = 'success' | 'info' | 'warn' | 'error';

type NotificationPayload = {
  kind: NotificationKind;
  title: string;
  body?: string;
};

/**
 * Broker Message shape — the shell hosts a WebSocketTransport bridge that
 * expects incoming frames to already be broker-Message-compatible so it
 * can inject them as if they'd been emitted locally.
 */
type Envelope = {
  id: string;
  topic: 'notification.show.v1';
  source: string;
  target: '*';
  data: NotificationPayload;
  timestamp: number;
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

let envelopeSeq = 0;

function envelope(payload: NotificationPayload): Envelope {
  return {
    id: `notif-backend-${++envelopeSeq}`,
    topic: 'notification.show.v1',
    source: 'notifications-backend',
    target: '*',
    data: payload,
    timestamp: Date.now(),
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

  // ── SSE канал ─────────────────────────────────────────────────────────
  //
  // Живёт параллельно с WebSocket'ом и отдаёт тот же envelope. Shell
  // сейчас потребляет ИМЕННО SSE (см. bridges.ts) — WebSocket остаётся
  // на бэке как эталон для сравнения / будущего duplex-канала.
  const sseClients = new Set<Response>();

  app.get('/sse/notifications', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // CORS для dev — shell на 3000, бэк на 4000.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders?.();
    // Retry hint браузеру: сколько подождать перед реконнектом.
    res.write('retry: 3000\n\n');

    sseClients.add(res);
    // eslint-disable-next-line no-console
    console.log(
      `[notifications:sse] client connected (total=${sseClients.size})`,
    );

    _req.on('close', () => {
      sseClients.delete(res);
      // eslint-disable-next-line no-console
      console.log(
        `[notifications:sse] client disconnected (total=${sseClients.size})`,
      );
    });
  });

  function broadcastSse(payload: NotificationPayload): number {
    const frame = `data: ${JSON.stringify(envelope(payload))}\n\n`;
    let sent = 0;
    for (const res of sseClients) {
      if (!res.writableEnded) {
        res.write(frame);
        sent += 1;
      }
    }
    return sent;
  }

  // Автопуш случайного демо-уведомления каждые 25 секунд. Летит и в WS,
  // и в SSE — так демо работает вне зависимости от того, какой транспорт
  // подключён на клиенте.
  const AUTO_PUSH_INTERVAL_MS = 25_000;
  setInterval(() => {
    if (clients.size === 0 && sseClients.size === 0) return;
    const picked =
      DEMO_NOTIFICATIONS[Math.floor(Math.random() * DEMO_NOTIFICATIONS.length)]!;
    broadcast(picked);
    broadcastSse(picked);
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

    const wsCount = broadcast(payload);
    const sseCount = broadcastSse(payload);
    res.json({
      ok: true,
      sent: wsCount + sseCount,
      channels: { ws: wsCount, sse: sseCount },
      payload,
    });
  });
}
