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

type Lang = 'en' | 'ru';

const DEMO_NOTIFICATIONS: Record<Lang, NotificationPayload[]> = {
  en: [
    {
      kind: 'success',
      title: 'Order #A-2041 is on the way',
      body: 'The courier arrives in ~15 minutes.',
    },
    {
      kind: 'info',
      title: '15% off mezze',
      body: 'Until end of day, promo code MEZE15.',
    },
    {
      kind: 'warn',
      title: 'Khachapuri almost out',
      body: 'Only 3 portions left for today.',
    },
    {
      kind: 'info',
      title: 'New dish on the menu',
      body: 'Try the falafel with walnut sauce.',
    },
  ],
  ru: [
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
  ],
};

function pickLang(raw: unknown): Lang {
  return raw === 'ru' ? 'ru' : 'en';
}

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

  const clients = new Map<WebSocket, Lang>();

  wss.on('connection', (socket, req) => {
    // Language comes in as `?lang=en|ru` in the WS handshake URL. Each client
    // remembers its own lang so multi-tab / mixed sessions can co-exist.
    const url = new URL(req.url ?? '/', 'http://x');
    const lang = pickLang(url.searchParams.get('lang'));
    clients.set(socket, lang);
    // eslint-disable-next-line no-console
    console.log(
      `[notifications] client connected (lang=${lang}, total=${clients.size})`,
    );

    socket.on('close', () => {
      clients.delete(socket);
      // eslint-disable-next-line no-console
      console.log(
        `[notifications] client disconnected (total=${clients.size})`,
      );
    });
  });

  function broadcast(explicit?: NotificationPayload): number {
    let sent = 0;
    for (const [client, lang] of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const payload =
        explicit ??
        DEMO_NOTIFICATIONS[lang][
          Math.floor(Math.random() * DEMO_NOTIFICATIONS[lang].length)
        ]!;
      client.send(JSON.stringify(envelope(payload)));
      sent += 1;
    }
    return sent;
  }

  // Автопуш случайного демо-уведомления каждые 25 секунд —
  // каждый клиент получает уведомление на своём языке.
  const AUTO_PUSH_INTERVAL_MS = 25_000;
  setInterval(() => {
    if (clients.size === 0) return;
    broadcast();
  }, AUTO_PUSH_INTERVAL_MS);

  // POST /notify?lang=xx — dev-триггер. Тело: { kind?, title, body? } или пусто.
  app.post('/notify', (req: Request, res: Response) => {
    const lang = pickLang((req.query.lang as string | undefined) ?? 'en');
    const body = req.body ?? {};
    const explicit: NotificationPayload | undefined =
      typeof body.title === 'string'
        ? {
            kind: (body.kind as NotificationKind) ?? 'info',
            title: body.title,
            body: typeof body.body === 'string' ? body.body : undefined,
          }
        : undefined;
    const preview =
      explicit ??
      DEMO_NOTIFICATIONS[lang][
        Math.floor(Math.random() * DEMO_NOTIFICATIONS[lang].length)
      ]!;
    const sent = broadcast(explicit);
    res.json({ ok: true, sent, payload: preview });
  });
}
