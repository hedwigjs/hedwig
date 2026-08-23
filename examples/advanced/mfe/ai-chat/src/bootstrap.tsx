import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { App } from './App';
import { installAiStreamAdapter } from './aiStreamAdapter';

type MountProps = {
  domElement?: HTMLElement;
};

let root: Root | null = null;
let adapterUnsubscribe: (() => void) | null = null;

export async function bootstrap(): Promise<void> {
  // Wire the SSE-backed responder for `chat.ask.v1` once, when the MFE
  // first boots. The subscription lives for the whole MFE lifetime;
  // useChat merely emits ask events.
  adapterUnsubscribe ??= installAiStreamAdapter();
  return Promise.resolve();
}

export async function mount(props: MountProps): Promise<void> {
  const target = props.domElement ?? document.getElementById('root');
  if (!target) throw new Error('ai-chat: no mount target');
  root = createRoot(target);
  root.render(<App />);
}

export async function unmount(): Promise<void> {
  root?.unmount();
  root = null;
  adapterUnsubscribe?.();
  adapterUnsubscribe = null;
}

declare global {
  interface Window {
    __AI_CHAT_STANDALONE__?: boolean;
  }
}

if (typeof window !== 'undefined' && window.__AI_CHAT_STANDALONE__) {
  void mount({});
}
