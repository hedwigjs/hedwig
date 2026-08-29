import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LateMountDemo } from './views/LateMountDemo';

type MountProps = {
  domElement?: HTMLElement;
};

let root: Root | null = null;

export async function bootstrap(): Promise<void> {
  // Nothing to do here — this MFE has no runtime side effects. The whole
  // point of the demo is that mounting is delayed until the user clicks
  // "Смонтировать" inside the panel.
}

export async function mount(props: MountProps): Promise<void> {
  const target = props.domElement ?? document.getElementById('root');
  if (!target) throw new Error('late-mount: no mount target');
  root = createRoot(target);
  root.render(<LateMountDemo />);
}

export async function unmount(): Promise<void> {
  root?.unmount();
  root = null;
}
