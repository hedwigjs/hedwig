import type { FC } from 'react';
import React from 'react';

import type { MenuItem } from '@hedwig-demo/contracts';

import styles from './MenuPosition.module.css';

const PlusIcon: FC = () => (
  <svg
    className={styles.icon}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M12 5v14M5 12h14"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
);

const MinusIcon: FC = () => (
  <svg
    className={styles.icon}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M5 12h14"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
);

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
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="20" r="1.4" fill="currentColor" />
    <circle cx="17" cy="20" r="1.4" fill="currentColor" />
  </svg>
);

type MenuPositionProps = {
  item: MenuItem;
  quantity: number;
  onAddToCart: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onOpenDetails: () => void;
};

export const MenuPosition: FC<MenuPositionProps> = ({
  item,
  quantity,
  onAddToCart,
  onIncrement,
  onDecrement,
  onOpenDetails,
}) => {
  const inCart = quantity > 0;

  const stopOpenModal = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <li className={styles.root} onClick={onOpenDetails}>
      <div className={styles.imageWrap}>
        <img className={styles.preview} src={item.previewUrl} alt={item.name} />
        {!inCart ? (
          <button
            type="button"
            className={styles.fabPlus}
            onClick={(e) => {
              stopOpenModal(e);
              onAddToCart();
            }}
            aria-label="Добавить в корзину"
          >
            <CartIcon />
          </button>
        ) : (
          <div
            className={styles.pillCounter}
            onClick={stopOpenModal}
            onPointerDown={stopOpenModal}
            role="presentation"
          >
            <button
              type="button"
              className={styles.pillBtn}
              onClick={onDecrement}
              aria-label="Уменьшить количество"
            >
              <MinusIcon />
            </button>
            <span className={styles.pillValue}>{quantity}</span>
            <button
              type="button"
              className={styles.pillBtn}
              onClick={onIncrement}
              aria-label="Увеличить количество"
            >
              <PlusIcon />
            </button>
          </div>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.price}>{item.price}</div>
        <div className={styles.name}>{item.name}</div>
      </div>
    </li>
  );
};
