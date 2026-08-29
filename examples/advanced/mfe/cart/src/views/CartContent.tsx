import type { FC } from 'react';
import React from 'react';

import type { CartItem } from '@hedwig-demo/contracts';

import { getLang } from '../../../../shared/i18n/useLang';

import { CartEmpty } from '../components/CartEmpty';
import { CartFooter } from '../components/CartFooter';
import { CartList } from '../components/CartList';
import { cartActions } from '../state/actions';

const currency = () =>
  new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'ru-RU');

type Props = {
  items: CartItem[];
  totalPrice: number;
  onAfterCheckout?: () => void;
};

/**
 * Тело корзины — общее для десктопной панели и мобильного попапа: либо
 * `<CartEmpty />`, либо список позиций плюс подвал с суммой и оформлением.
 */
export const CartContent: FC<Props> = ({ items, totalPrice, onAfterCheckout }) => {
  if (items.length === 0) {
    return <CartEmpty />;
  }

  return (
    <>
      <CartList
        items={items}
        onIncrement={cartActions.increment}
        onDecrement={cartActions.decrement}
        onRemove={cartActions.remove}
      />
      <CartFooter
        totalPrice={`${currency().format(totalPrice)} ₽`}
        onCheckout={() => {
          cartActions.checkout({ items, totalPrice });
          onAfterCheckout?.();
        }}
      />
    </>
  );
};
