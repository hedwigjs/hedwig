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
    | 'menu'
    | 'cart-panel'
    | 'cart-header'
    | 'late-mount'
    | 'remote-request'
    | 'ai-chat'
    | 'notifications'
    | 'checkout'
    | 'analytics';
  loader: () => Promise<MfeModule>;
}> = [
  {
    name: 'menu',
    slot: 'menu',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('menu/App' as any) as Promise<MfeModule>,
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
    // Demo of a late joiner. Own bundle chunk, own client id
    // (`late-mount-demo`); mounts on demand and gets the current cart from
    // the `state` topic `cart.snapshot.v1` before its first paint, no replay
    // option needed — see mfe/cart/src/views/LateMountDemo.
    name: 'late-mount',
    slot: 'late-mount',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('cart/LateMount' as any) as Promise<MfeModule>,
  },
  {
    // Demo of a request to a remote client: `bus.request('notifications-backend',
    // 'notification.status.v1', …)` crosses the WebSocket with a
    // correlationId and a deadline. Own card, own chunk, own client id
    // (`remote-request-demo`) — see mfe/cart/src/views/RemoteRequestDemo.
    name: 'remote-request',
    slot: 'remote-request',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('cart/RemoteRequest' as any) as Promise<MfeModule>,
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
    // Headless: обрабатывает request `checkout.start.v1` от cart, показывает iframe
    // в портале — сам slot остаётся пустым (aria-hidden).
    name: 'checkout',
    slot: 'checkout',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('checkout/App' as any) as Promise<MfeModule>,
  },
  {
    // Semi-trusted read-only widget — demonstrates broker ACL hooks
    // installed in `security/installAclHooks.ts`.
    name: 'analytics',
    slot: 'analytics',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: () => import('analytics/App' as any) as Promise<MfeModule>,
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
