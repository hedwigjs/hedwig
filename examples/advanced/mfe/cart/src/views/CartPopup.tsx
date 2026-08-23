import type { FC } from 'react';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useCartSnapshot } from '../state/useCartSnapshot';
import { CartContent } from './CartContent';

import styles from './CartPopup.module.css';

type Props = {
  onClose: () => void;
};

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

/**
 * Попап корзины: на мобилке — фуллскрин лист, на планшете — плавающая
 * панель по центру. Использует ту же `CartContent`, что и десктопная панель.
 */
export const CartPopup: FC<Props> = ({ onClose }) => {
  const { items, totalItems, totalPrice } = useCartSnapshot();

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
        aria-label="Корзина"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.heading}>
            <h2 className={styles.title}>Корзина</h2>
            {totalItems > 0 && (
              <span className={styles.badge}>
                {totalItems} {pluralize(totalItems, ['позиция', 'позиции', 'позиций'])}
              </span>
            )}
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
        <div className={styles.body}>
          <CartContent
            items={items}
            totalPrice={totalPrice}
            onAfterCheckout={onClose}
          />
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
};
