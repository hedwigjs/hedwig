import type { FC } from 'react';
import React from 'react';

import styles from './CartEmpty.module.css';

export const CartEmpty: FC = () => (
  <div className={styles.root}>
    <div className={styles.iconWrap} aria-hidden="true">
      <svg viewBox="0 0 48 48" className={styles.icon}>
        <path
          d="M8 12h5l4 22h20l4-16H14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="19" cy="40" r="2.4" fill="currentColor" />
        <circle cx="33" cy="40" r="2.4" fill="currentColor" />
      </svg>
    </div>
    <p className={styles.title}>Корзина пуста</p>
    <p className={styles.subtitle}>Выберите что-нибудь из меню слева.</p>
  </div>
);
