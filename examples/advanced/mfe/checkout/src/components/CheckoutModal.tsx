import type { FC } from 'react';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import styles from './CheckoutModal.module.css';

const currency = new Intl.NumberFormat('ru-RU');

type Props = {
  iframeUrl: string;
  totalPrice: number;
  itemCount: number;
  onClose: () => void;
};

export const CheckoutModal: FC<Props> = ({
  iframeUrl,
  totalPrice,
  itemCount,
  onClose,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const node = (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Оплата заказа"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.summary}>
            <span className={styles.eyebrow}>Оплата · {itemCount} поз.</span>
            <span className={styles.total}>{currency.format(totalPrice)} ₽</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <iframe
          className={styles.frame}
          src={iframeUrl}
          title="Форма оплаты"
        />
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
};
