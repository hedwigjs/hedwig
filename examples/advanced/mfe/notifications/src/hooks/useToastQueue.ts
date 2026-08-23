import { useCallback, useEffect, useRef, useState } from 'react';

import type { TopicPayloads } from '@hedwig-demo/contracts';

import { toastBus } from '../clients/bus';

export type ToastItem = TopicPayloads['notification.show.v1'] & {
  id: string;
};

type Payload = TopicPayloads['notification.show.v1'];

const AUTO_DISMISS_MS = 6000;
const MAX_TOASTS = 5;

type Envelope = {
  topic: 'notification.show.v1';
  payload: Payload;
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
 * Toast queue — a single reader with two ingress paths:
 *
 *  1. **Cross-MFE via bus** — subscribes to `notification.show.v1`; other
 *     MFEs (e.g. checkout) emit here.
 *  2. **Server push via WebSocket** — connects directly to the backend
 *     notifications channel. Both source (this WS) and sink (this state)
 *     live inside the notifications MFE, so we skip the bus for this path.
 *     Routing intra-MFE data through a shared broker would only add
 *     sender-exclusion foot-guns without any observability benefit.
 *
 * Auto-dismiss after AUTO_DISMISS_MS; manual dismiss via `dismiss(id)`.
 */
export function useToastQueue(wsUrl: string) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const scheduleAutoDismiss = useCallback((id: string) => {
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, AUTO_DISMISS_MS);
    timers.current.set(id, timer);
  }, []);

  const addToast = useCallback(
    (payload: Payload) => {
      const id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, ...payload }].slice(-MAX_TOASTS));
      scheduleAutoDismiss(id);
    },
    [scheduleAutoDismiss],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  // Cross-MFE ingress via bus
  useEffect(() => {
    return toastBus.on('notification.show.v1', (msg) => addToast(msg.data));
  }, [addToast]);

  // Server push ingress via WebSocket (direct, bypasses bus by design).
  // Exponential backoff up to 15s on connection failure.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryDelay = 1000;

    function connect(): void {
      if (cancelled) return;

      try {
        socket = new WebSocket(wsUrl);
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
        addToast(parsed.payload);
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
  }, [wsUrl, addToast]);

  // Clean up all pending auto-dismiss timers on unmount.
  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      currentTimers.forEach((t) => window.clearTimeout(t));
      currentTimers.clear();
    };
  }, []);

  return { toasts, dismiss };
}
