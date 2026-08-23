import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { startCartRuntime } from './state/cartStore';
import { CartHeaderTrigger } from './views/CartHeaderTrigger';

type MountProps = {
  domElement?: HTMLElement;
};

let root: Root | null = null;

export async function bootstrap(): Promise<void> {
  startCartRuntime();
}

export async function mount(props: MountProps): Promise<void> {
  const target = props.domElement ?? document.getElementById('root');
  if (!target) throw new Error('cart-header-trigger: no mount target');
  root = createRoot(target);
  root.render(<CartHeaderTrigger />);
}

export async function unmount(): Promise<void> {
  root?.unmount();
  root = null;
}
