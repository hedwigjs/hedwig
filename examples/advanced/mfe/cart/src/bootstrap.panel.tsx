import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { startCartRuntime } from './state/cartStore';
import { CartPanel } from './views/CartPanel';

type MountProps = {
  domElement?: HTMLElement;
};

let root: Root | null = null;

export async function bootstrap(): Promise<void> {
  startCartRuntime();
}

export async function mount(props: MountProps): Promise<void> {
  const target = props.domElement ?? document.getElementById('root');
  if (!target) throw new Error('cart-panel: no mount target');
  root = createRoot(target);
  root.render(<CartPanel />);
}

export async function unmount(): Promise<void> {
  root?.unmount();
  root = null;
}

declare global {
  interface Window {
    __CART_STANDALONE__?: boolean;
  }
}

if (typeof window !== 'undefined' && window.__CART_STANDALONE__) {
  startCartRuntime();
  void mount({});
}
