import { useEffect } from 'react';

import { mockBus } from '@hedwig-demo/mock-bus';
import type { TopicPayloads } from '@hedwig-demo/contracts';

type Envelope = {
  topic: 'notification.show.v1';
  payload: TopicPayloads['notification.show.v1'];
  ts: number;
};

function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as { topic?: unknown; payload?: { title?: unknown } };
  return (
    v.topic === 'notification.show.v1' &&
    !!v.payload &&
    typeof v.payload === 'object' &&
    typeof v.payload.title === 'string'
  );
}

/**
 * Открывает WS-канал к backend'у и мостит все `notification.show.v1`
 * envelope'ы в mock-bus. Реконнект — экспоненциальный backoff до 15s.
 */
export function useNotificationsSocket(url: string): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryDelay = 1000;

    function connect(): void {
      if (cancelled) return;

      try {
        socket = new WebSocket(url);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[notifications] socket construct failed', err);
        scheduleReconnect();
        return;
      }

      socket.addEventListener('open', () => {
        retryDelay = 1000;
      });

      socket.addEventListener('message', (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (!isEnvelope(parsed)) return;
        mockBus.emit('notification.show.v1', parsed.payload);
      });

      socket.addEventListener('close', () => {
        if (cancelled) return;
        scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        // `error` всегда сопровождается `close` — реконнектимся оттуда.
      });
    }

    function scheduleReconnect(): void {
      if (cancelled) return;
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, 15_000);
      retryTimer = window.setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [url]);
}
