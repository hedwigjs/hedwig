import type { FC } from 'react';
import React from 'react';

import { Toast } from './components/Toast';
import { useNotificationsSocket } from './hooks/useNotificationsSocket';
import { useToastQueue } from './hooks/useToastQueue';

import styles from './App.module.css';

const BACKEND_WS_URL =
  (typeof process !== 'undefined' && process.env?.NOTIFICATIONS_WS_URL) ||
  'ws://localhost:4000/ws/notifications';

export const App: FC = () => {
  const { toasts, dismiss } = useToastQueue();

  // Мост: WS → mock-bus. UI слушает не сокет напрямую, а топик
  // `notification.show.v1` — так же, как это будет с @hedwigjs/broker.
  useNotificationsSocket(BACKEND_WS_URL);

  return (
    <div className={styles.stack}>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          kind={t.kind}
          title={t.title}
          body={t.body}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
};
