import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { RemoteRequestDemo } from './views/RemoteRequestDemo';

type MountProps = {
  domElement?: HTMLElement;
};

let root: Root | null = null;

export async function bootstrap(): Promise<void> {
  // No runtime side effects: the client (`remote-request-demo`) is created
  // by the view itself when it mounts.
}

export async function mount(props: MountProps): Promise<void> {
  const target = props.domElement ?? document.getElementById('root');
  if (!target) throw new Error('remote-request: no mount target');
  root = createRoot(target);
  root.render(<RemoteRequestDemo />);
}

export async function unmount(): Promise<void> {
  root?.unmount();
  root = null;
}
