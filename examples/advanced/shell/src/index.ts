import './styles/reset.css';
import './styles/layout.css';

import { initBroker } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { renderChrome } from './chrome/renderChrome';
import { registerMicrofrontends } from './registerMicrofrontends';
import { mountDevTools } from './devtools';
import {
  installBackendNotificationsBridge,
  installCrossTabCartBridge,
} from './bridges';
import { installAclHooks } from './security/installAclHooks';

// Bring up the broker once for this browser realm — every MFE that calls
// `createClient(id)` will get a client bound to this instance (MF `shared:
// singleton` ensures the module is not duplicated across remotes).
initBroker<Topic, TopicPayloads>({
  history: { enabled: true, maxSize: 50 },
});

async function main() {
  // ACL must be armed before any MFE tries to subscribe or send —
  // otherwise the first mount would slip through the guardrails.
  installAclHooks();

  renderChrome();
  mountDevTools();
  installBackendNotificationsBridge();
  installCrossTabCartBridge();
  await registerMicrofrontends();
}

void main();
