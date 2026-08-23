import type { CartItem } from '@hedwig-demo/contracts';

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

function computeTotals(items: CartItem[]) {
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce(
    (sum, i) => sum + parsePrice(i.price) * i.quantity,
    0,
  );
  return { totalItems, totalPrice };
}

/**
 * Идемпотентный старт. Первый вызов подписывает runtime на bus'у и начинает
 * держать состояние. Все последующие — no-op. Безопасно звать из любого
 * bootstrap'а (panel/header-trigger) — кто первый смонтировался, тот и запустил.
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

  runtimeBus.on('cart.item-added.v1', (msg) => {
    const payload = msg.data;
    if (state[payload.itemId]) return;
    state = {
      ...state,
      [payload.itemId]: {
        itemId: payload.itemId,
        name: payload.name,
        price: payload.price,
        quantity: 1,
      },
    };
    emitSnapshot();
  });

  runtimeBus.on('cart.item-incremented.v1', (msg) => {
    const { itemId } = msg.data;
    const current = state[itemId];
    if (!current) return;
    state = {
      ...state,
      [itemId]: { ...current, quantity: current.quantity + 1 },
    };
    emitSnapshot();
  });

  runtimeBus.on('cart.item-decremented.v1', (msg) => {
    const { itemId } = msg.data;
    const current = state[itemId];
    if (!current) return;
    if (current.quantity <= 1) {
      const { [itemId]: _dropped, ...rest } = state;
      state = rest;
    } else {
      state = {
        ...state,
        [itemId]: { ...current, quantity: current.quantity - 1 },
      };
    }
    emitSnapshot();
  });

  runtimeBus.on('cart.item-removed.v1', (msg) => {
    const { itemId } = msg.data;
    if (!state[itemId]) return;
    const { [itemId]: _dropped, ...rest } = state;
    state = rest;
    emitSnapshot();
  });

  // Fire an initial empty snapshot so late-joining subscribers (with `replay`)
  // don't get `undefined` before any bus events.
  emitSnapshot();
}
