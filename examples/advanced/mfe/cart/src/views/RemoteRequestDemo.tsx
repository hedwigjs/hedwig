import type { FC } from 'react';
import React, { useEffect, useState } from 'react';

import { useClient, useRequest } from '@hedwigjs/react';
import type { Topic, TopicContracts, TopicPayloads } from '@hedwig-demo/contracts';

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

/**
 * Demo card: a request that crosses a transport. The client id has one
 * ACL rule — it may send `notification.status.v1` to
 * `notifications-backend` and nothing else. The response never passes
 * through hooks: it is matched to the pending request by `correlationId`
 * on the remote client that carried the request.
 *
 * `useClient` owns the client for the card's lifetime; `useRequest` owns
 * `pending` / `result`, with the answer typed by the contract.
 */
export const RemoteRequestDemo: FC = () => {
  const bus = useClient<Topic, TopicPayloads, TopicContracts>('remote-request-demo');
  const status = useRequest(bus, 'notifications-backend', 'notification.status.v1', { timeout: 3000 });
  const [timing, setTiming] = useState<{ latencyMs: number; at: string } | null>(null);
  const busy = status.pending;
  const outcome = status.result && timing ? { result: status.result, ...timing } : null;

  async function ask(): Promise<void> {
    if (busy) return;
    const started = performance.now();
    await status.send({ includeLang: true });
    setTiming({ latencyMs: Math.round(performance.now() - started), at: new Date().toLocaleTimeString() });
  }

  // A stale timing must never pair with a fresh result.
  useEffect(() => {
    if (!status.result) setTiming(null);
  }, [status.result]);

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
