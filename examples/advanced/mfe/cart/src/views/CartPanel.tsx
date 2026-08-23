import type { FC } from 'react';
import React from 'react';

import { CartHeader } from '../components/CartHeader';
import { useCartSnapshot } from '../state/useCartSnapshot';
import { CartContent } from './CartContent';

import styles from './CartPanel.module.css';

/**
 * Desktop-side cart panel — the one that lives in the right column above
 * 1200px. Reads snapshot from the bus, actions go through `cartActions`.
 */
export const CartPanel: FC = () => {
  const { items, totalItems, totalPrice } = useCartSnapshot();

  return (
    <div className={styles.root}>
      <CartHeader totalItems={totalItems} />
      <CartContent items={items} totalPrice={totalPrice} />
    </div>
  );
};
