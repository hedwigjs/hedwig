import type { FC } from 'react';
import React from 'react';

import { t } from '../../../../shared/i18n/useLang';

import styles from './CartFooter.module.css';

const T = {
  en: { total: 'Total', checkout: 'Check out' },
  ru: { total: 'Итого', checkout: 'Оформить заказ' },
} as const;

type Props = {
  totalPrice: string;
  onCheckout: () => void;
};

export const CartFooter: FC<Props> = ({ totalPrice, onCheckout }) => (
  <footer className={styles.root}>
    <div className={styles.totalRow}>
      <span className={styles.totalLabel}>{t(T, 'total')}</span>
      <span className={styles.totalValue}>{totalPrice}</span>
    </div>
    <button type="button" className={styles.checkout} onClick={onCheckout}>
      {t(T, 'checkout')}
    </button>
  </footer>
);
