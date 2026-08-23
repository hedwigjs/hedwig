import React from 'react';
import { createRoot } from 'react-dom/client';

import { getBroker } from '@hedwigjs/broker';
import { MessageBrokerDevTools } from '@hedwigjs/devtools';
import { registry } from '@hedwig-demo/contracts';

/**
 * Mount the DevTools panel into its own detached React root — the shell
 * chrome is imperative innerHTML, so DevTools brings its own React tree.
 */
export function mountDevTools(): void {
  const host = document.createElement('div');
  host.setAttribute('data-hedwig-devtools-root', '');
  document.body.appendChild(host);

  const root = createRoot(host);
  root.render(
    <MessageBrokerDevTools
      broker={getBroker()}
      registry={registry}
      enabled
      defaultOpen={false}
    />,
  );
}
