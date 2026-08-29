import type { CartItem } from '@hedwig-demo/contracts';
import type {
  CartAddItemResponse,
  CartDecrementResponse,
  CartRemoveItemResponse,
} from '@hedwig-demo/contracts';

import { runtimeBus } from '../clients/bus';

type CartState = Record<number, CartItem>;

/**
 * Single source-of-truth for cart state — kept intentionally outside React
 * so that multiple cart views (desktop panel + mobile header trigger) can be
 * mounted simultaneously without each holding its own copy.
 *
 * Parked on `window` because the runtime-started flag needs to be shared
 * across Module Federation-loaded copies of this module. The broker itself
 * is a distinct concern — shared via MF `singleton: true`.
 */
const GLOBAL_KEY = '__HEDWIG_DEMO_CART_RUNTIME__' as const;

type Runtime = {
  started: boolean;
};

type GlobalHost = typeof globalThis & {
  [GLOBAL_KEY]?: Runtime;
};

function getRuntime(): Runtime {
  const host = globalThis as GlobalHost;
  if (!host[GLOBAL_KEY]) {
    host[GLOBAL_KEY] = { started: false };
  }
  return host[GLOBAL_KEY]!;
}

function parsePrice(price: string): number {
  const digits = price.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function computeSubtotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + parsePrice(i.price) * i.quantity, 0);
}

function computeTotals(items: CartItem[]) {
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = computeSubtotal(items);
  return { totalItems, totalPrice };
}

/**
 * Идемпотентный старт. Первый вызов регистрирует cart-runtime как обработчик
 * request'ов на мутации корзины и как publisher `cart.snapshot.v1`. Все
 * последующие — no-op. Безопасно звать из любого bootstrap'а.
 *
 * Архитектурная разметка после перевода на CQRS:
 *  - Мутации приходят как **request** от любого MFE (menu, cart-ui,
 *    checkout). Handler возвращает response — sender видит результат
 *    (`RoutingResult.data`).
 *  - Текущее состояние — **state broadcast** `cart.snapshot.v1` с
 *    `history: true`, чтобы late-joiner получал последний snapshot через
 *    `on(..., { replay: { limit: 1 } })`.
 */
export function startCartRuntime(): void {
  const rt = getRuntime();
  if (rt.started) return;
  rt.started = true;

  let state: CartState = {};

  const emitSnapshot = () => {
    const items = Object.values(state);
    const { totalItems, totalPrice } = computeTotals(items);
    // `history: true` records this emit into the broker's replay buffer so
    // late subscribers with `replay: { limit: 1 }` receive it on subscribe.
    void runtimeBus.emit(
      'cart.snapshot.v1',
      { items, totalItems, totalPrice },
      { history: true },
    );
  };

  runtimeBus.on('cart.add-item.v1', (msg): CartAddItemResponse => {
    const payload = msg.data;
    const existing = state[payload.itemId];
    const nextQuantity = existing ? existing.quantity + 1 : 1;

    state = {
      ...state,
      [payload.itemId]: existing
        ? { ...existing, quantity: nextQuantity }
        : {
            itemId: payload.itemId,
            name: payload.name,
            price: payload.price,
            quantity: 1,
          },
    };

    emitSnapshot();
    return {
      itemId: payload.itemId,
      quantity: nextQuantity,
      subtotal: computeSubtotal(Object.values(state)),
    };
  });

  runtimeBus.on('cart.decrement.v1', (msg): CartDecrementResponse => {
    const { itemId } = msg.data;
    const current = state[itemId];
    if (!current) {
      return { itemId, quantity: 0, subtotal: computeSubtotal(Object.values(state)) };
    }
    if (current.quantity <= 1) {
      const { [itemId]: _dropped, ...rest } = state;
      state = rest;
      emitSnapshot();
      return { itemId, quantity: 0, subtotal: computeSubtotal(Object.values(state)) };
    }
    const nextQuantity = current.quantity - 1;
    state = {
      ...state,
      [itemId]: { ...current, quantity: nextQuantity },
    };
    emitSnapshot();
    return {
      itemId,
      quantity: nextQuantity,
      subtotal: computeSubtotal(Object.values(state)),
    };
  });

  runtimeBus.on('cart.remove-item.v1', (msg): CartRemoveItemResponse => {
    const { itemId } = msg.data;
    if (!state[itemId]) {
      return { itemId, removed: false, subtotal: computeSubtotal(Object.values(state)) };
    }
    const { [itemId]: _dropped, ...rest } = state;
    state = rest;
    emitSnapshot();
    return {
      itemId,
      removed: true,
      subtotal: computeSubtotal(Object.values(state)),
    };
  });

  // Fire an initial empty snapshot so late-joining subscribers (with `replay`)
  // don't get `undefined` before any commands.
  emitSnapshot();
}
