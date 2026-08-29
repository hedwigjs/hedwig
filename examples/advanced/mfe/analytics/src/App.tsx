import type { FC } from 'react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { CheckoutStartResponse } from '@hedwig-demo/contracts';

import { bus } from './clients/bus';

import styles from './App.module.css';

/**
 * Topics analytics tries to observe. The shell-side ACL allows the first
 * three (anonymous UI/notification events) and blocks the fourth
 * (`cart.snapshot.v1` — private cart contents).
 */
const ALLOWED_SUBSCRIPTIONS = [
  'ui.menu-item-opened.v1',
  'ui.menu-item-closed.v1',
  'notification.show.v1',
] as const;

type AttemptState = { status: 'idle' } | { status: 'ok' | 'denied'; message: string };

/**
 * Analytics MFE — a semi-trusted read-only tracker.
 *
 * Purpose in the demo: exercise the broker's `onSubscribe` and `beforeSend`
 * hooks, which the shell wires to an ACL config. Analytics is allowed to
 * observe anonymous UI events and shown notifications; every other topic
 * is denied by default. It also cannot send anything.
 */
export const App: FC = () => {
  const [counter, setCounter] = useState(0);
  const [peekResult, setPeekResult] = useState<AttemptState>({ status: 'idle' });
  const [checkoutResult, setCheckoutResult] = useState<AttemptState>({
    status: 'idle',
  });

  // Establish the allowed subscriptions on mount. Each one bumps the tracked
  // counter — analytics doesn't care about payload contents, just that the
  // event happened.
  useEffect(() => {
    const offs = ALLOWED_SUBSCRIPTIONS.map((topic) =>
      bus.on(topic, () => {
        setCounter((n) => n + 1);
      }),
    );
    return () => offs.forEach((off) => off());
  }, []);

  const tryPeekCart = useCallback(() => {
    setPeekResult({ status: 'idle' });
    // `on` throws synchronously when the onSubscribe hook denies —
    // analytics catches it and reports the message.
    try {
      const off = bus.on('cart.snapshot.v1', () => {
        /* would receive cart contents */
      });
      // If we ever get here, the shell's ACL doesn't cover cart.snapshot for
      // analytics — that would be a bug. Unsubscribe immediately.
      off();
      setPeekResult({
        status: 'ok',
        message: 'Подписка прошла — правило ACL отсутствует!',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPeekResult({ status: 'denied', message });
    }
  }, []);

  const tryTriggerCheckout = useCallback(async () => {
    setCheckoutResult({ status: 'idle' });
    // `request` never throws for hook rejection — it resolves with a
    // NACK RoutingResult carrying `reason: HOOK_REJECTED`. Analytics
    // inspects the status and displays the human-readable message.
    const result = await bus.request<'checkout.start.v1', CheckoutStartResponse>(
      'checkout',
      'checkout.start.v1',
      { items: [], totalPrice: 0 },
    );
    if (result.status === 'ACK') {
      setCheckoutResult({
        status: 'ok',
        message: `Checkout принял (сессия ${result.data?.sessionId ?? '?'}). ACL должен был заблокировать!`,
      });
    } else {
      setCheckoutResult({
        status: 'denied',
        message: `${result.reason}: ${result.message}`,
      });
    }
  }, []);

  const allowedPills = useMemo(
    () =>
      ALLOWED_SUBSCRIPTIONS.map((topic) => (
        <span key={topic} className={styles.pill}>
          <span className={styles.pillCheck}>✓</span> {topic}
        </span>
      )),
    [],
  );

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <p className={styles.title}>Аналитика</p>
        <span className={styles.badge}>ACL demo</span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionTitle}>Разрешённые подписки</p>
          <span className={styles.counter}>
            <span className={styles.counterNumber}>{counter}</span>
            {' '}событий
          </span>
        </div>
        <div className={styles.allowedList}>{allowedPills}</div>
      </div>

      <div className={styles.demoBox}>
        <p className={styles.sectionTitle}>ACL demo — попробовать нарушить</p>

        <div className={styles.attemptRow}>
          <p className={styles.attemptHint}>
            <strong>Заглянуть в корзину.</strong> Аналитика не должна видеть её
            содержимое. При подписке на <code>cart.snapshot.v1</code>{' '}
            <code>onSubscribe</code>-hook отклонит подписку и{' '}
            <code>bus.on()</code> бросит исключение.
          </p>
          <button className={styles.btn} type="button" onClick={tryPeekCart}>
            bus.on(&apos;cart.snapshot.v1&apos;, …)
          </button>
          {peekResult.status !== 'idle' && (
            <div
              className={`${styles.result} ${peekResult.status === 'denied' ? styles.resultDenied : styles.resultOk}`}
            >
              <span className={styles.resultLabel}>
                {peekResult.status === 'denied'
                  ? '↯ отклонено'
                  : '✓ пропущено'}
              </span>
              {peekResult.message}
            </div>
          )}
        </div>

        <div className={styles.attemptRow}>
          <p className={styles.attemptHint}>
            <strong>Инициировать checkout.</strong> Аналитика не должна
            запускать бизнес-flow. При отправке{' '}
            <code>checkout.start.v1</code> <code>beforeSend</code>-hook вернёт
            NACK с причиной <code>HOOK_REJECTED</code> — блокировка видна и в
            DevTools.
          </p>
          <button
            className={styles.btn}
            type="button"
            onClick={() => void tryTriggerCheckout()}
          >
            bus.request(&apos;checkout&apos;, &apos;checkout.start.v1&apos;, …)
          </button>
          {checkoutResult.status !== 'idle' && (
            <div
              className={`${styles.result} ${checkoutResult.status === 'denied' ? styles.resultDenied : styles.resultOk}`}
            >
              <span className={styles.resultLabel}>
                {checkoutResult.status === 'denied'
                  ? '↯ отклонено'
                  : '✓ пропущено'}
              </span>
              {checkoutResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
