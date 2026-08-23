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
  if (!target) throw new Error('notifications: no mount target');
  root = createRoot(target);
  root.render(<App />);
}

export async function unmount(): Promise<void> {
  root?.unmount();
  root = null;
}

declare global {
  interface Window {
    __NOTIFICATIONS_STANDALONE__?: boolean;
  }
}

if (typeof window !== 'undefined' && window.__NOTIFICATIONS_STANDALONE__) {
  void mount({});
}
