import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { App } from './App';

type MountProps = {
  domElement?: HTMLElement;
};

let root: Root | null = null;

export async function bootstrap(): Promise<void> {
  return Promise.resolve();
}

export async function mount(props: MountProps): Promise<void> {
  const target = props.domElement ?? document.getElementById('root');
  if (!target) throw new Error('storefront: no mount target');
  root = createRoot(target);
  root.render(<App />);
}

export async function unmount(): Promise<void> {
  root?.unmount();
  root = null;
}

declare global {
  interface Window {
    __STOREFRONT_STANDALONE__?: boolean;
  }
}

// Standalone dev: when opened at http://localhost:3001 directly, mount into #root.
// When loaded via single-spa, the host calls `mount({ domElement })` instead.
if (typeof window !== 'undefined' && window.__STOREFRONT_STANDALONE__) {
  void mount({});
}
