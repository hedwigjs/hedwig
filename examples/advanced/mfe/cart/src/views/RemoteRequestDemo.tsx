import type { FC } from 'react';
import React, { useEffect, useRef, useState } from 'react';

import { createClient } from '@hedwigjs/client';
import type { RoutingResult } from '@hedwigjs/client';
import type { NotificationStatusResponse, Topic, TopicContracts, TopicPayloads } from '@hedwig-demo/contracts';

import { t } from '../../../../shared/i18n/useLang';

import styles from './LateMountDemo.module.css';

const T = {
  en: {
    title: 'Request to a remote',
    badge: 'request demo',
    intro: 'The notifications backend is a remote client over WebSocket. A plain',
    outro:
      'goes out as a wire frame with a correlationId and a deadline; the backend answers with a response frame matched by that id. No backend, no answer — the request resolves NACK TIMEOUT locally.',
    ask: 'Ask the backend',
    asking: 'Waiting for the response…',
    connected: 'connected clients',
    uptime: 'uptime',
    latency: 'round trip',
    seconds: 's',
  },
  ru: {
    title: 'Запрос удалённому клиенту',
    badge: 'request demo',
    intro: 'Backend уведомлений — удалённый клиент по WebSocket. Обычный',
    outro:
      'уходит кадром с correlationId и deadline; backend отвечает кадром-ответом с тем же id. Нет backend — нет ответа, запрос локально завершается NACK TIMEOUT.',
    ask: 'Спросить backend',
    asking: 'Ждём ответ…',
    connected: 'подключено клиентов',
    uptime: 'аптайм',
    latency: 'туда-обратно',
    seconds: 'с',
  },
} as const;

type Outcome = {
  result: RoutingResult<NotificationStatusResponse>;
  latencyMs: number;
  at: string;
};

/**
 * Demo card: a request that crosses a transport. The client id has one
 * ACL rule — it may send `notification.status.v1` to
 * `notifications-backend` and nothing else. The response never passes
 * through hooks: it is matched to the pending request by `correlationId`
 * on the remote client that carried the request.
 */
export const RemoteRequestDemo: FC = () => {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const clientRef = useRef<ReturnType<typeof createClient<Topic, TopicPayloads>> | null>(null);

  useEffect(() => {
    clientRef.current = createClient<Topic, TopicPayloads, TopicContracts>('remote-request-demo');
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  async function ask(): Promise<void> {
    const client = clientRef.current;
    if (!client || busy) return;
    setBusy(true);
    const started = performance.now();
    const result = await client.request<'notification.status.v1', NotificationStatusResponse>(
      'notifications-backend',
      'notification.status.v1',
      { includeLang: true },
      { timeout: 3000 },
    );
    setOutcome({
      result,
      latencyMs: Math.round(performance.now() - started),
      at: new Date().toLocaleTimeString(),
    });
    setBusy(false);
  }

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t(T, 'title')}</h2>
        <span className={styles.badge}>{t(T, 'badge')}</span>
      </header>
      <p className={styles.description}>
        {t(T, 'intro')}{' '}
        <code>bus.request('notifications-backend', 'notification.status.v1', …)</code>{' '}
        {t(T, 'outro')}
      </p>
      <button type="button" className={styles.button} onClick={() => void ask()} disabled={busy}>
        {busy ? t(T, 'asking') : t(T, 'ask')}
      </button>
      {outcome && (
        <div className={styles.result} data-demo-remote-request={outcome.result.status}>
          <div className={styles.resultHeader}>
            <span className={styles.resultLabel}>
              {outcome.result.status} {outcome.result.reason} · {outcome.at}
            </span>
            <span className={styles.resultReplayed}>
              {t(T, 'latency')} {outcome.latencyMs} ms
            </span>
          </div>
          {outcome.result.status === 'ACK' && outcome.result.data ? (
            <div className={styles.resultBody}>
              <span className={styles.resultKey}>{t(T, 'connected')}</span>
              <span className={styles.resultValue}>{outcome.result.data.connected}</span>
              <span className={styles.resultKey}>{t(T, 'uptime')}</span>
              <span className={styles.resultValue}>
                {Math.round(outcome.result.data.uptimeMs / 1000)} {t(T, 'seconds')}
              </span>
              <span className={styles.resultKey}>lang</span>
              <span className={styles.resultValue}>{outcome.result.data.lang}</span>
            </div>
          ) : (
            <p className={styles.resultWaiting}>{outcome.result.message}</p>
          )}
        </div>
      )}
    </section>
  );
};
