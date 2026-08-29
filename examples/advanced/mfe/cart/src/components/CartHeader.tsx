import type { FC } from 'react';
import React from 'react';

import { getLang, t } from '../../../../shared/i18n/useLang';

import styles from './CartHeader.module.css';

type Props = {
  totalItems: number;
};

const T = {
  en: { title: 'Cart', item_one: 'item', item_few: 'items', item_many: 'items' },
  ru: {
    title: 'Корзина',
    item_one: 'позиция',
    item_few: 'позиции',
    item_many: 'позиций',
  },
} as const;

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

function pluralizeEn(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}

function itemLabel(n: number): string {
  if (getLang() === 'en') return pluralizeEn(n, t(T, 'item_one'), t(T, 'item_few'));
  return pluralize(n, [t(T, 'item_one'), t(T, 'item_few'), t(T, 'item_many')]);
}

export const CartHeader: FC<Props> = ({ totalItems }) => (
  <header className={styles.root}>
    <h2 className={styles.title}>{t(T, 'title')}</h2>
    {totalItems > 0 && (
      <span className={styles.badge}>
        {totalItems} {itemLabel(totalItems)}
      </span>
    )}
  </header>
);
