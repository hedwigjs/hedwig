import { useCallback, useEffect, useRef, useState } from 'react';

import type { TopicPayloads } from '@hedwig-demo/contracts';

import { toastBus } from '../clients/bus';

export type ToastItem = TopicPayloads['notification.show.v1'] & {
  id: string;
};

const AUTO_DISMISS_MS = 6000;
const MAX_TOASTS = 5;

/**
 * Pure subscriber: renders every `notification.show.v1` that reaches the
 * broker. Sources are decoupled — the topic is emitted directly by other
 * MFEs (e.g. checkout) AND injected by the shell's WebSocket bridge that
 * relays backend pushes. From this hook's perspective, all inputs look
 * the same.
 *
 * Auto-dismiss after AUTO_DISMISS_MS; manual dismiss via `dismiss(id)`.
 */
export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const off = toastBus.on('notification.show.v1', (msg) => {
      const payload = msg.data;
      const id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, ...payload }].slice(-MAX_TOASTS));

      const timer = window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timers.current.delete(id);
      }, AUTO_DISMISS_MS);
      timers.current.set(id, timer);
    });

    return () => {
      off();
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current.clear();
    };
  }, []);

  return { toasts, dismiss };
}
