import type { FC } from 'react';
import React, { useEffect, useState } from 'react';

import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import styles from './LateMountDemo.module.css';

type Snapshot = TopicPayloads['cart.snapshot.v1'];

const currency = new Intl.NumberFormat('ru-RU');

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
        setReceivedAt(new Date().toLocaleTimeString('ru-RU'));
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
          <span className={styles.resultLabel}>Ждём сообщение…</span>
        </div>
        <p className={styles.resultWaiting}>
          Подписка установлена, буфер пуст либо реплей ещё не отработал.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.result}>
      <div className={styles.resultHeader}>
        <span className={styles.resultLabel}>
          cart.snapshot.v1 · получено{receivedAt ? ` в ${receivedAt}` : ''}
        </span>
        <span className={styles.resultReplayed}>из буфера</span>
      </div>
      <div className={styles.resultBody}>
        <span className={styles.resultKey}>позиций</span>
        <span className={styles.resultValue}>{snapshot.totalItems}</span>
        <span className={styles.resultKey}>уникальных</span>
        <span className={styles.resultValue}>{snapshot.items.length}</span>
        <span className={styles.resultKey}>сумма</span>
        <span className={styles.resultValue}>
          {currency.format(snapshot.totalPrice)} ₽
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
        <h2 className={styles.title}>Отложенный маунт</h2>
        <span className={styles.badge}>replay demo</span>
      </header>
      <p className={styles.description}>
        Демонстрация буфера истории. Модуль монтируется по кнопке уже после
        того, как в корзине что-то есть, и просит брокер отдать последнее
        сообщение <code>cart.snapshot.v1</code> —{' '}
        <code>on(topic, h, {'{'} replay: {'{'} limit: 1 {'}'} {'}'})</code>.
        Продюсер не переотправляет ничего; состояние приходит из буфера.
      </p>
      <button
        type="button"
        className={`${styles.button}${mounted ? ` ${styles.buttonMounted}` : ''}`}
        onClick={() => setMounted((v) => !v)}
      >
        {mounted ? 'Размонтировать' : 'Смонтировать'}
      </button>
      {mounted && <LateJoiningConsumer />}
    </section>
  );
};
