import React from 'react';
import { createRoot } from 'react-dom/client';

import { getBroker } from '@hedwigjs/broker';
import { registry } from '@hedwig-demo/contracts';

/**
 * Mount the DevTools panel into its own detached React root — the shell
 * chrome is imperative innerHTML, so DevTools brings its own React tree.
 *
 * The panel is loaded with a dynamic `import()` so it lands in its own
 * chunk instead of the shell's main bundle. This is the pattern we want
 * consumers to copy: `@hedwigjs/devtools` is ~400 KB of React UI and has
 * no business in a production entry chunk. The reference stand keeps it
 * on in every build because it *is* the demo; a real app would wrap the
 * import in `if (process.env.NODE_ENV !== 'production')`.
 */
export async function mountDevTools(): Promise<void> {
  const { MessageBrokerDevTools } = await import('@hedwigjs/devtools');

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
