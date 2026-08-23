import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';

import { useCartSnapshot } from '../state/useCartSnapshot';
import { CartPopup } from './CartPopup';

import styles from './CartHeaderTrigger.module.css';

const CartIcon: FC = () => (
  <svg
    className={styles.icon}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M4 6h2l2 11h10l2-8H8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="20" r="1.4" fill="currentColor" />
    <circle cx="17" cy="20" r="1.4" fill="currentColor" />
  </svg>
);

/**
 * Компактный триггер cart'а для шапки на планшете и мобилке. Иконка + бейдж
 * с количеством, при клике открывает попап со всей корзиной.
 */
export const CartHeaderTrigger: FC = () => {
  const { totalItems } = useCartSnapshot();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Автоматически закрываем попап, если ушли на десктоп — там уже показана
  // полноценная панель, второе представление не нужно.
  useEffect(() => {
    if (typeof window === 'undefined' || !open) return;
    const mq = window.matchMedia('(min-width: 1200px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) close();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label={totalItems > 0 ? `Корзина, ${totalItems} позиций` : 'Корзина пуста'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CartIcon />
        {totalItems > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {totalItems > 99 ? '99+' : totalItems}
          </span>
        )}
      </button>
      {open && <CartPopup onClose={close} />}
    </>
  );
};
