import type { FC } from 'react';
import React from 'react';

import type { CartItem } from '@hedwig-demo/contracts';

import { t } from '../../../../shared/i18n/useLang';

import styles from './CartList.module.css';

const T = {
  en: { dec: 'Decrease quantity', inc: 'Increase quantity', remove: 'Remove item' },
  ru: {
    dec: 'Уменьшить количество',
    inc: 'Увеличить количество',
    remove: 'Удалить позицию',
  },
} as const;

type Props = {
  items: CartItem[];
  onIncrement: (itemId: number) => void;
  onDecrement: (itemId: number) => void;
  onRemove: (itemId: number) => void;
};

const PlusIcon: FC = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 5v14M5 12h14"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
);

const MinusIcon: FC = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

const TrashIcon: FC = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M5 7h14M10 7V5a1 1 0 011-1h2a1 1 0 011 1v2M7 7l1 12a2 2 0 002 2h4a2 2 0 002-2l1-12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CartList: FC<Props> = ({ items, onIncrement, onDecrement, onRemove }) => (
  <ul className={styles.list}>
    {items.map((item) => (
      <li key={item.itemId} className={styles.row}>
        <div className={styles.info}>
          <div className={styles.name}>{item.name}</div>
          <div className={styles.price}>{item.price}</div>
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.qtyBtn}
            onClick={() => onDecrement(item.itemId)}
            aria-label={t(T, 'dec')}
          >
            <MinusIcon />
          </button>
          <span className={styles.qty}>{item.quantity}</span>
          <button
            type="button"
            className={styles.qtyBtn}
            onClick={() => onIncrement(item.itemId)}
            aria-label={t(T, 'inc')}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className={`${styles.qtyBtn} ${styles.removeBtn}`}
            onClick={() => onRemove(item.itemId)}
            aria-label={t(T, 'remove')}
          >
            <TrashIcon />
          </button>
        </div>
      </li>
    ))}
  </ul>
);
