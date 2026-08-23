import type { FC } from 'react';
import React from 'react';

import styles from './CartHeader.module.css';

type Props = {
  totalItems: number;
};

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

export const CartHeader: FC<Props> = ({ totalItems }) => (
  <header className={styles.root}>
    <h2 className={styles.title}>Корзина</h2>
    {totalItems > 0 && (
      <span className={styles.badge}>
        {totalItems} {pluralize(totalItems, ['позиция', 'позиции', 'позиций'])}
      </span>
    )}
  </header>
);
