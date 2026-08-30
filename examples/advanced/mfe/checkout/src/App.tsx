import type { FC } from 'react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { getBroker, PostMessageTransport } from '@hedwigjs/broker';
import type {
  CartItem,
  CartRemoveItemResponse,
  CheckoutStartResponse,
  Topic,
  TopicPayloads,
} from '@hedwig-demo/contracts';

import { bus } from './clients/bus';
import { CheckoutModal } from './components/CheckoutModal';

import { getLang } from '../../../shared/i18n/useLang';

// Full URL base for the iframe (protocol + host + path prefix — everything
// except the query string). Baked at build time by webpack's
// EnvironmentPlugin. Dev default points at the backend dev-server; prod
// points at nginx-proxied path under /demo/advanced.
const IFRAME_URL_BASE = process.env.CHECKOUT_IFRAME_URL as string;

const IFRAME_ORIGIN = new URL(IFRAME_URL_BASE).origin;
const IFRAME_URL = `${IFRAME_URL_BASE}?lang=${getLang()}`;

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

  // Handler for the cart → checkout START request. Registered on the same
  // topic as any sender (cart-ui) would call. Returning the response synchronously
  // ACKs the cart before the modal is even mounted — sender's `await` resolves
  // with `{ sessionId, ready: true }` and knows the hand-off succeeded.
  useEffect(() => {
    return bus.on('checkout.start.v1', (msg): CheckoutStartResponse => {
      const { items, totalPrice } = msg.data;
      if (items.length > 0) {
        setPending({ items, totalPrice });
      }
      return {
        sessionId: `chk-${Date.now().toString(36)}`,
        ready: true,
      };
    });
  }, []);

  // React to iframe → bus injection. Runs regardless of pending state so we
  // never race with the bridge injection timing.
  useEffect(() => {
    return bus.on('checkout.completed.v1', (msg) => {
      const payload = msg.data;

      const en = getLang() === 'en';
      void bus.emit('notification.show.v1', {
        kind: 'success',
        title: en
          ? `Order ${payload.orderId} accepted`
          : `Заказ ${payload.orderId} принят`,
        body: en
          ? 'Its status will land in the notifications panel shortly.'
          : 'Скоро появится статус в панели уведомлений.',
      });

      // Clear the checked-out lines from the cart via targeted requests to
      // cart-store — checkout doesn't own cart state, it just asks the
      // runtime to drop each purchased line.
      const items = pendingRef.current?.items ?? [];
      for (const item of items) {
        void bus.request<'cart.remove-item.v1', CartRemoveItemResponse>(
          'cart-store',
          'cart.remove-item.v1',
          { itemId: item.itemId },
        );
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
