import type { FC } from 'react';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { MenuItem } from '@hedwig-demo/contracts';

import styles from './MenuItemModal.module.css';

type MenuItemModalProps = {
  item: MenuItem;
  quantity: number;
  onAddToCart: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onClose: () => void;
};

const PlusIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 5v14M5 12h14"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

const MinusIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M5 12h14"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

export const MenuItemModal: FC<MenuItemModalProps> = ({
  item,
  quantity,
  onAddToCart,
  onIncrement,
  onDecrement,
  onClose,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const inCart = quantity > 0;

  const node = (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-item-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Закрыть"
        >
          ×
        </button>

        <div className={styles.media}>
          <img className={styles.hero} src={item.previewUrl} alt="" />
        </div>

        <div className={styles.content}>
          <div className={styles.copy}>
            <h2 id="menu-item-modal-title" className={styles.title}>
              {item.name}
            </h2>
            <p className={styles.description}>{item.description}</p>

            <div className={styles.nutrition}>
              <dl className={styles.nutritionGrid}>
                <div className={styles.nutritionCell}>
                  <dt className={styles.nutritionLabel}>Ккал</dt>
                  <dd className={styles.nutritionValue}>
                    {item.nutrition.caloriesKcal}
                  </dd>
                </div>
                <div className={styles.nutritionCell}>
                  <dt className={styles.nutritionLabel}>Белки</dt>
                  <dd className={styles.nutritionValue}>
                    {item.nutrition.proteinG} г
                  </dd>
                </div>
                <div className={styles.nutritionCell}>
                  <dt className={styles.nutritionLabel}>Жиры</dt>
                  <dd className={styles.nutritionValue}>
                    {item.nutrition.fatG} г
                  </dd>
                </div>
                <div className={styles.nutritionCell}>
                  <dt className={styles.nutritionLabel}>Углеводы</dt>
                  <dd className={styles.nutritionValue}>
                    {item.nutrition.carbsG} г
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className={styles.actionBar}>
            <div className={styles.price}>{item.price}</div>
            {!inCart ? (
              <button
                type="button"
                className={styles.addBtn}
                onClick={onAddToCart}
              >
                <span className={styles.addBtnIcon} aria-hidden="true">
                  <PlusIcon />
                </span>
                Добавить в корзину
              </button>
            ) : (
              <div className={styles.pillCounter}>
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
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(node, document.body);
};
