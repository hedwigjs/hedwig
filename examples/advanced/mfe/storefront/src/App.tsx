import type { FC } from 'react';
import React, { useState } from 'react';

import type { MenuItem } from '@hedwig-demo/contracts';

import { MenuItemModal } from './components/MenuItemModal/MenuItemModal';
import { MenuPosition } from './components/MenuPosition/MenuPosition';
import { useLocalCartQuantities } from './hooks/useLocalCartQuantities';
import { useMenu } from './hooks/useMenu';

import styles from './App.module.css';

export const App: FC = () => {
  const { items, loading, error } = useMenu();
  const { getQty, addFirst, increment, decrement } = useLocalCartQuantities();
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Меню недели · Сезон 03</span>
        <h1 className={styles.title}>
          Домашняя <em>кухня</em>
        </h1>
        <p className={styles.lead}>
          Ближневосточные и грузинские мотивы в спокойной подаче — забираем сегодня
          или везём в течение часа.
        </p>
      </header>

      <div className={styles.divider}>
        <span className={styles.sectionLabel}>Всё меню</span>
        <span className={styles.itemCount}>
          {items.length.toString().padStart(2, '0')} позиций
        </span>
      </div>

      {loading && <p className={styles.status}>Загрузка…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <ul className={styles.positionsGrid}>
          {items.map((item) => (
            <MenuPosition
              key={item.id}
              item={item}
              quantity={getQty(item.id)}
              onAddToCart={() => addFirst(item)}
              onIncrement={() => increment(item.id)}
              onDecrement={() => decrement(item.id)}
              onOpenDetails={() => setDetailItem(item)}
            />
          ))}
        </ul>
      )}
      {detailItem && (
        <MenuItemModal
          item={detailItem}
          quantity={getQty(detailItem.id)}
          onAddToCart={() => addFirst(detailItem)}
          onIncrement={() => increment(detailItem.id)}
          onDecrement={() => decrement(detailItem.id)}
          onClose={() => setDetailItem(null)}
        />
      )}
    </div>
  );
};
