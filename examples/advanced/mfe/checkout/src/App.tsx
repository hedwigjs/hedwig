import type { FC } from 'react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { getBroker, PostMessageTransport } from '@hedwigjs/broker';
import type { CartItem, Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { bus } from './clients/bus';
import { CheckoutModal } from './components/CheckoutModal';

const IFRAME_ORIGIN =
  (typeof process !== 'undefined' && process.env?.CHECKOUT_IFRAME_ORIGIN) ||
  'http://localhost:4000';

const IFRAME_URL = `${IFRAME_ORIGIN}/checkout`;

const BRIDGE_ID = 'checkout-iframe';

type PendingOrder = {
  items: CartItem[];
  totalPrice: number;
};

/**
 * Headless checkout controller.
 *
 * Wire:
 *  1. Listens for `cart.checkout-requested.v1` → shows the modal.
 *  2. On iframe load, attaches a PostMessage bridge to the iframe's window.
 *     When the iframe sends `checkout.completed.v1` (as a broker-Message
 *     envelope), the bridge injects it into the local broker.
 *  3. A separate `bus.on('checkout.completed.v1', ...)` handler fans out:
 *     tostit success, clears the cart, closes the modal.
 *
 * Bridge is the transport, `bus.on` is the reaction — no hand-rolled
 * `window.addEventListener('message', ...)` on this side.
 */
export const App: FC = () => {
  const [pending, setPending] = useState<PendingOrder | null>(null);
  // The most recent pending order — read by the completed-handler because
  // the payload carries only orderId, not the items to clear.
  const pendingRef = useRef<PendingOrder | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const close = useCallback((reason?: 'user-closed') => {
    setPending((prev) => {
      if (prev && reason === 'user-closed') {
        void bus.emit('checkout.cancelled.v1', { reason: 'user-closed' });
      }
      return null;
    });
  }, []);

  // Trigger from cart
  useEffect(() => {
    return bus.on('cart.checkout-requested.v1', (msg) => {
      const { items, totalPrice } = msg.data;
      if (items.length === 0) return;
      setPending({ items, totalPrice });
    });
  }, []);

  // React to iframe → bus injection. Runs regardless of pending state so we
  // never race with the bridge injection timing.
  useEffect(() => {
    return bus.on('checkout.completed.v1', (msg) => {
      const payload = msg.data;

      void bus.emit('notification.show.v1', {
        kind: 'success',
        title: `Заказ ${payload.orderId} принят`,
        body: 'Скоро появится статус в панели уведомлений.',
      });

      const items = pendingRef.current?.items ?? [];
      for (const item of items) {
        void bus.emit('cart.item-removed.v1', { itemId: item.itemId });
      }

      setPending(null);
    });
  }, []);

  // Bridge lifecycle: attach when the iframe reports ready, detach on close.
  // Tracked via ref because the callback identity must be stable across
  // re-renders of the modal.
  const removeBridgeRef = useRef<(() => void) | null>(null);

  const onIframeReady = useCallback((win: Window) => {
    // Rebuild the bridge every time a new iframe loads (React may recreate
    // the element between opens/closes).
    removeBridgeRef.current?.();

    const broker = getBroker<Topic, TopicPayloads>();
    const transport = new PostMessageTransport({
      target: win,
      origin: IFRAME_ORIGIN,
    });
    removeBridgeRef.current = broker.addBridge(BRIDGE_ID, {
      transport,
      forward: ['checkout.completed.v1'],
    });
  }, []);

  useEffect(() => {
    if (!pending) {
      removeBridgeRef.current?.();
      removeBridgeRef.current = null;
    }
  }, [pending]);

  useEffect(() => {
    return () => {
      removeBridgeRef.current?.();
      removeBridgeRef.current = null;
    };
  }, []);

  if (!pending) return null;

  return (
    <CheckoutModal
      iframeUrl={IFRAME_URL}
      totalPrice={pending.totalPrice}
      itemCount={pending.items.reduce((s, i) => s + i.quantity, 0)}
      onClose={() => close('user-closed')}
      onIframeReady={onIframeReady}
    />
  );
};
