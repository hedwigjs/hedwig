import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';

import type { CartItem, TopicPayloads } from '@hedwig-demo/contracts';
import { mockBus } from '@hedwig-demo/mock-bus';

import { CheckoutModal } from './components/CheckoutModal';

const IFRAME_ORIGIN =
  (typeof process !== 'undefined' && process.env?.CHECKOUT_IFRAME_ORIGIN) ||
  'http://localhost:4000';

const IFRAME_URL = `${IFRAME_ORIGIN}/checkout`;

type PendingOrder = {
  items: CartItem[];
  totalPrice: number;
};

type CompletedPayload = TopicPayloads['checkout.completed.v1'];

function isCompletedMessage(
  data: unknown,
): data is { source: string; topic: string; payload: CompletedPayload } {
  if (!data || typeof data !== 'object') return false;
  const d = data as { source?: unknown; topic?: unknown; payload?: unknown };
  if (d.source !== 'hedwig-checkout') return false;
  if (d.topic !== 'checkout.completed.v1') return false;
  const p = d.payload as { orderId?: unknown } | undefined;
  return !!p && typeof p.orderId === 'string';
}

/**
 * Headless checkout controller. Ловит `cart.checkout-requested.v1`,
 * показывает iframe с формой оплаты, слушает `postMessage` от неё и:
 *   - эмитит `checkout.completed.v1` в шину,
 *   - тостит успех через `notification.show.v1`,
 *   - очищает корзину (по одному `cart.item-removed.v1` на позицию).
 */
export const App: FC = () => {
  const [pending, setPending] = useState<PendingOrder | null>(null);

  const close = useCallback((reason?: 'user-closed') => {
    setPending((prev) => {
      if (prev && reason === 'user-closed') {
        mockBus.emit('checkout.cancelled.v1', { reason: 'user-closed' });
      }
      return null;
    });
  }, []);

  useEffect(() => {
    return mockBus.on('cart.checkout-requested.v1', ({ items, totalPrice }) => {
      if (items.length === 0) return;
      setPending({ items, totalPrice });
    });
  }, []);

  useEffect(() => {
    if (!pending) return;

    function onMessage(event: MessageEvent) {
      if (event.origin !== IFRAME_ORIGIN) return;
      if (!isCompletedMessage(event.data)) return;

      const payload = event.data.payload;
      mockBus.emit('checkout.completed.v1', payload);

      mockBus.emit('notification.show.v1', {
        kind: 'success',
        title: `Заказ ${payload.orderId} принят`,
        body: 'Скоро появится статус в панели уведомлений.',
      });

      // Очищаем корзину — по одному `removed`, чтобы cart-runtime сам
      // прогнал стандартный путь и опубликовал пустой snapshot.
      for (const item of pending!.items) {
        mockBus.emit('cart.item-removed.v1', { itemId: item.itemId });
      }

      setPending(null);
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pending]);

  if (!pending) return null;

  return (
    <CheckoutModal
      iframeUrl={IFRAME_URL}
      totalPrice={pending.totalPrice}
      itemCount={pending.items.reduce((s, i) => s + i.quantity, 0)}
      onClose={() => close('user-closed')}
    />
  );
};
