import { registerApplication, start } from 'single-spa';

import { getMountNode } from './chrome/slots';

type LifecycleFn = (props: unknown) => Promise<void>;
type MfeModule = {
  bootstrap: LifecycleFn;
  mount: LifecycleFn;
  unmount: LifecycleFn;
};

/**
 * MFE registry — add a line per remote as it comes online.
 *
 * Each entry maps a slot in the page chrome (see `chrome/slots.ts`) to a
 * Module-Federation loader.
 */
const registry: Array<{
  name: string;
  slot:
    | 'storefront'
    | 'cart-panel'
    | 'cart-header'
    | 'ai-chat'
    | 'notifications'
    | 'checkout';
  loader: () => Promise<MfeModule>;
}> = [
  {
    name: 'storefront',
    slot: 'storefront',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('storefront/App' as any) as Promise<MfeModule>,
  },
  {
    // Оба cart-представления монтируются всегда — какое видно, решает CSS
    // (media query по 1200px). Ниже 1200 показывается только header-триггер,
    // выше — только панель. Runtime SoT общий (см. cart/src/state/cartStore.ts).
    name: 'cart-panel',
    slot: 'cart-panel',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('cart/Panel' as any) as Promise<MfeModule>,
  },
  {
    name: 'cart-header',
    slot: 'cart-header',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('cart/HeaderTrigger' as any) as Promise<MfeModule>,
  },
  {
    name: 'ai-chat',
    slot: 'ai-chat',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('ai_chat/App' as any) as Promise<MfeModule>,
  },
  {
    name: 'notifications',
    slot: 'notifications',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('notifications/App' as any) as Promise<MfeModule>,
  },
  {
    // Headless: слушает `cart.checkout-requested.v1`, показывает iframe в
    // портале — сам slot остаётся пустым (aria-hidden).
    name: 'checkout',
    slot: 'checkout',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('checkout/App' as any) as Promise<MfeModule>,
  },
];

export async function registerMicrofrontends(): Promise<void> {
  for (const { name, slot, loader } of registry) {
    const domElement = getMountNode(slot);

    registerApplication({
      name,
      app: loader,
      activeWhen: () => true,
      customProps: { domElement },
    });
  }

  start();
}
