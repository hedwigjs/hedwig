import type { FC } from 'react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { CheckoutStartResponse } from '@hedwig-demo/contracts';

import { t } from '../../../shared/i18n/useLang';

import { bus } from './clients/bus';

import styles from './App.module.css';

const T = {
  en: {
    title: 'Analytics',
    badge: 'ACL demo',
    allowed: 'Allowed subscriptions',
    events: 'events',
    demoTitle: 'ACL demo — try to break the rules',
    peekTitle: 'Peek into the cart.',
    peekBody:
      "Analytics must not see the cart's contents. When subscribing to",
    peekBody2:
      "the onSubscribe hook rejects and bus.on() throws.",
    checkoutTitle: 'Trigger checkout.',
    checkoutBody:
      'Analytics must not launch business flows. When sending',
    checkoutBody2:
      'the beforeSend hook returns NACK with reason HOOK_REJECTED — visible in DevTools.',
    denied: '↯ denied',
    passed: '✓ passed',
    okPeek: 'Subscription went through — the ACL rule is missing!',
  },
  ru: {
    title: 'Аналитика',
    badge: 'ACL demo',
    allowed: 'Разрешённые подписки',
    events: 'событий',
    demoTitle: 'ACL demo — попробовать нарушить',
    peekTitle: 'Заглянуть в корзину.',
    peekBody: 'Аналитика не должна видеть её содержимое. При подписке на',
    peekBody2: 'onSubscribe-hook отклонит подписку и bus.on() бросит исключение.',
    checkoutTitle: 'Инициировать checkout.',
    checkoutBody: 'Аналитика не должна запускать бизнес-flow. При отправке',
    checkoutBody2:
      'beforeSend-hook вернёт NACK с причиной HOOK_REJECTED — блокировка видна и в DevTools.',
    denied: '↯ отклонено',
    passed: '✓ пропущено',
    okPeek: 'Подписка прошла — правило ACL отсутствует!',
  },
} as const;

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
      setPeekResult({ status: 'ok', message: t(T, 'okPeek') });
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
        message: `checkout accepted (session ${result.data?.sessionId ?? '?'}). ACL should have blocked it!`,
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
        <p className={styles.title}>{t(T, 'title')}</p>
        <span className={styles.badge}>{t(T, 'badge')}</span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionTitle}>{t(T, 'allowed')}</p>
          <span className={styles.counter}>
            <span className={styles.counterNumber}>{counter}</span>
            {' '}{t(T, 'events')}
          </span>
        </div>
        <div className={styles.allowedList}>{allowedPills}</div>
      </div>

      <div className={styles.demoBox}>
        <p className={styles.sectionTitle}>{t(T, 'demoTitle')}</p>

        <div className={styles.attemptRow}>
          <p className={styles.attemptHint}>
            <strong>{t(T, 'peekTitle')}</strong> {t(T, 'peekBody')}{' '}
            <code>cart.snapshot.v1</code> {t(T, 'peekBody2')}
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
                  ? t(T, 'denied')
                  : t(T, 'passed')}
              </span>
              {peekResult.message}
            </div>
          )}
        </div>

        <div className={styles.attemptRow}>
          <p className={styles.attemptHint}>
            <strong>{t(T, 'checkoutTitle')}</strong> {t(T, 'checkoutBody')}{' '}
            <code>checkout.start.v1</code> {t(T, 'checkoutBody2')}
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
                  ? t(T, 'denied')
                  : t(T, 'passed')}
              </span>
              {checkoutResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
