import type { FC } from 'react';
import React from 'react';

import styles from './CartFooter.module.css';

type Props = {
  totalPrice: string;
  onCheckout: () => void;
};

export const CartFooter: FC<Props> = ({ totalPrice, onCheckout }) => (
  <footer className={styles.root}>
    <div className={styles.totalRow}>
      <span className={styles.totalLabel}>Итого</span>
      <span className={styles.totalValue}>{totalPrice}</span>
    </div>
    <button type="button" className={styles.checkout} onClick={onCheckout}>
      Оформить заказ
    </button>
  </footer>
);
