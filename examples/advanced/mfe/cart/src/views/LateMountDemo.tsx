import type { FC } from 'react';
import React, { useEffect, useState } from 'react';

import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { getLang, t } from '../../../../shared/i18n/useLang';

import styles from './LateMountDemo.module.css';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const T = {
  en: {
    title: 'Late mount',
    badge: 'replay demo',
    intro: 'History-buffer demo. The module mounts on demand — after items are in the cart — and asks the broker for the latest',
    outro: 'message. The producer re-emits nothing; state comes from the buffer.',
    mount: 'Mount',
    unmount: 'Unmount',
    waiting: 'Waiting for message…',
    waitingHint: 'Subscription established, buffer empty or replay pending.',
    received: 'received',
    fromBuffer: 'from buffer',
    positions: 'total items',
    unique: 'unique',
    sum: 'total',
  },
  ru: {
    title: 'Отложенный маунт',
    badge: 'replay demo',
    intro: 'Демонстрация буфера истории. Модуль монтируется по кнопке уже после того, как в корзине что-то есть, и просит брокер отдать последнее сообщение',
    outro: '. Продюсер не переотправляет ничего; состояние приходит из буфера.',
    mount: 'Смонтировать',
    unmount: 'Размонтировать',
    waiting: 'Ждём сообщение…',
    waitingHint: 'Подписка установлена, буфер пуст либо реплей ещё не отработал.',
    received: 'получено',
    fromBuffer: 'из буфера',
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
 * Every mount creates its own client and asks the broker for the LAST
 * recorded `cart.snapshot.v1` from the replay buffer via
 * `on(..., { replay: { limit: 1 } })`.
 *
 * `cart-runtime` records every snapshot with `{ history: true }` (see
 * `cartStore.ts`) so this component receives the latest state the moment
 * it subscribes — no live emit required.
 */
const LateJoiningConsumer: FC = () => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);

  useEffect(() => {
    const client = createClient<Topic, TopicPayloads>('late-mount-demo');
    const off = client.on(
      'cart.snapshot.v1',
      (msg) => {
        setSnapshot(msg.data);
        setReceivedAt(
          new Date().toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'ru-RU'),
        );
      },
      { replay: { limit: 1 } },
    );
    return () => {
      off();
      client.destroy();
    };
  }, []);

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
 * from the broker's replay buffer instead of live traffic. Purpose is to
 * show that a late-joining module doesn't need the producer to re-emit —
 * it asks for the last snapshot via `replay: { limit: 1 }` and gets it.
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
        {t(T, 'intro')} <code>cart.snapshot.v1</code> —{' '}
        <code>on(topic, h, {'{'} replay: {'{'} limit: 1 {'}'} {'}'})</code>
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
