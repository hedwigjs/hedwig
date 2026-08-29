import type { FC } from 'react';
import React, { useCallback, useState } from 'react';

import type { MenuItem } from '@hedwig-demo/contracts';

import { getLang, t } from '../../../shared/i18n/useLang';

import { bus } from './clients/bus';
import { MenuItemModal } from './components/MenuItemModal/MenuItemModal';
import { MenuPosition } from './components/MenuPosition/MenuPosition';
import { useLocalCartQuantities } from './hooks/useLocalCartQuantities';
import { useMenu } from './hooks/useMenu';

import styles from './App.module.css';

const T = {
  en: {
    eyebrow: 'Menu of the week · Season 03',
    titleA: 'Homestyle',
    titleEm: 'kitchen',
    lead: 'Middle Eastern and Georgian motifs, quietly plated — pick up today or delivered within the hour.',
    all: 'Full menu',
    items: 'items',
    loading: 'Loading…',
  },
  ru: {
    eyebrow: 'Меню недели · Сезон 03',
    titleA: 'Домашняя',
    titleEm: 'кухня',
    lead: 'Ближневосточные и грузинские мотивы в спокойной подаче — забираем сегодня или везём в течение часа.',
    all: 'Всё меню',
    items: 'позиций',
    loading: 'Загрузка…',
  },
} as const;

export const App: FC = () => {
  const { items, loading, error } = useMenu();
  const { getQty, addFirst, increment, decrement } = useLocalCartQuantities();
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);

  // Обёртки для open/close модалки блюда — эмитят пару UI-событий, на которые
  // подписана analytics (см. shell/src/security/acl.ts). Держим open+close на
  // одной кодовой траектории, чтобы не забыть про closed при добавлении
  // альтернативных путей закрытия (Escape, backdrop, автозакрытие после
  // добавления в корзину и т.д.).
  const openDetails = useCallback((item: MenuItem) => {
    setDetailItem(item);
    void bus.emit('ui.menu-item-opened.v1', { item });
  }, []);

  const closeDetails = useCallback(() => {
    setDetailItem((prev) => {
      if (prev) {
        void bus.emit('ui.menu-item-closed.v1', { itemId: prev.id });
      }
      return null;
    });
  }, []);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>{t(T, 'eyebrow')}</span>
        <h1 className={styles.title}>
          {t(T, 'titleA')} <em>{t(T, 'titleEm')}</em>
        </h1>
        <p className={styles.lead}>{t(T, 'lead')}</p>
      </header>

      <div className={styles.divider}>
        <span className={styles.sectionLabel}>{t(T, 'all')}</span>
        <span className={styles.itemCount}>
          {items.length.toString().padStart(2, '0')} {t(T, 'items')}
        </span>
      </div>

      {loading && <p className={styles.status}>{t(T, 'loading')}</p>}
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
              onOpenDetails={() => openDetails(item)}
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
          onClose={closeDetails}
        />
      )}
    </div>
  );
};
