import type { FC } from 'react';
import React, { useEffect, useState } from 'react';

import { useClient, useStateTopic } from '@hedwigjs/react';
import type { Topic, TopicContracts, TopicPayloads } from '@hedwig-demo/contracts';

import { getLang, t } from '../../../../shared/i18n/useLang';

import styles from './LateMountDemo.module.css';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const T = {
  en: {
    title: 'Late mount',
    badge: 'replay demo',
    intro: 'State-topic demo. The module mounts on demand — after items are in the cart — and simply subscribes to',
    outro: '. The producer re-emits nothing: the runtime retains the last value of a state topic and hands it over inside on().',
    mount: 'Mount',
    unmount: 'Unmount',
    waiting: 'Waiting for message…',
    waitingHint: 'Subscription established, buffer empty or replay pending.',
    received: 'received',
    fromBuffer: 'retained',
    positions: 'total items',
    unique: 'unique',
    sum: 'total',
  },
  ru: {
    title: 'Отложенный маунт',
    badge: 'replay demo',
    intro: 'Демонстрация топика-состояния. Модуль монтируется по кнопке уже после того, как в корзине что-то есть, и просто подписывается на',
    outro: '. Продюсер ничего не переотправляет: рантайм хранит последнее значение state-топика и отдаёт его внутри on().',
    mount: 'Смонтировать',
    unmount: 'Размонтировать',
    waiting: 'Ждём сообщение…',
    waitingHint: 'Подписка установлена, буфер пуст либо реплей ещё не отработал.',
    received: 'получено',
    fromBuffer: 'retained',
    positions: 'позиций',
    unique: 'уникальных',
    sum: 'сумма',
  },
} as const;

function currency(): Intl.NumberFormat {
  return new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'ru-RU');
}

/**
 * Actual late-joining consumer. Mounted / unmounted on demand by the parent.
 * `useClient` gives it a client for exactly its lifetime; `useStateTopic`
 * subscribes to `cart.snapshot.v1` before paint. It is a `state` topic, so
 * the runtime hands over the retained (last) snapshot inside `on()` — no
 * live emit, no replay option, no `useEffect` bookkeeping here.
 */
const LateJoiningConsumer: FC = () => {
  const client = useClient<Topic, TopicPayloads, TopicContracts>('late-mount-demo');
  const snapshot: Snapshot | undefined = useStateTopic(client, 'cart.snapshot.v1');
  const [receivedAt, setReceivedAt] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) setReceivedAt(new Date().toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'ru-RU'));
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div className={styles.result}>
        <div className={styles.resultHeader}>
          <span className={styles.resultLabel}>{t(T, 'waiting')}</span>
        </div>
        <p className={styles.resultWaiting}>{t(T, 'waitingHint')}</p>
      </div>
    );
  }

  return (
    <div className={styles.result}>
      <div className={styles.resultHeader}>
        <span className={styles.resultLabel}>
          cart.snapshot.v1 · {t(T, 'received')}{receivedAt ? ` · ${receivedAt}` : ''}
        </span>
        <span className={styles.resultReplayed}>{t(T, 'fromBuffer')}</span>
      </div>
      <div className={styles.resultBody}>
        <span className={styles.resultKey}>{t(T, 'positions')}</span>
        <span className={styles.resultValue}>{snapshot.totalItems}</span>
        <span className={styles.resultKey}>{t(T, 'unique')}</span>
        <span className={styles.resultValue}>{snapshot.items.length}</span>
        <span className={styles.resultKey}>{t(T, 'sum')}</span>
        <span className={styles.resultValue}>
          {currency().format(snapshot.totalPrice)} ₽
        </span>
      </div>
    </div>
  );
};

/**
 * Demo card: a separately-mounted MFE that reads the current cart state
 * from the runtime's retained value instead of live traffic. Purpose is to
 * show that a late-joining module doesn't need the producer to re-emit —
 * a `state` topic's last value comes with the subscription.
 */
export const LateMountDemo: FC = () => {
  const [mounted, setMounted] = useState(false);

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t(T, 'title')}</h2>
        <span className={styles.badge}>{t(T, 'badge')}</span>
      </header>
      <p className={styles.description}>
        {t(T, 'intro')} <code>cart.snapshot.v1</code>
        {t(T, 'outro')}
      </p>
      <button
        type="button"
        className={`${styles.button}${mounted ? ` ${styles.buttonMounted}` : ''}`}
        onClick={() => setMounted((v) => !v)}
      >
        {mounted ? t(T, 'unmount') : t(T, 'mount')}
      </button>
      {mounted && <LateJoiningConsumer />}
    </section>
  );
};
