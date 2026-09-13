import './styles/reset.css';
import './styles/layout.css';

import { initBroker } from '@hedwigjs/broker';
import { TOPIC_KINDS } from '@hedwig-demo/contracts';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { renderChrome } from './chrome/renderChrome';
import { registerMicrofrontends } from './registerMicrofrontends';
import { mountDevTools } from './devtools';
import {
  installBackendNotificationsRemote,
  installCrossTabCartRemote,
} from './remotes';
import { installAclHooks } from './security/installAclHooks';

// Bring up the broker once for this browser realm — every MFE that calls
// `createClient(id)` will get a client bound to this instance (MF `shared:
// singleton` ensures the module is not duplicated across remotes).
initBroker<Topic, TopicPayloads>({
  history: { enabled: true, maxSize: 50 },
  // Topic kinds from the contracts registry. `state` topics (the cart
  // snapshot) are retained by the runtime and handed to every new
  // subscriber — no `history: true` at the emit site, no `replay` on `on()`.
  topics: TOPIC_KINDS,
  // Arms `broker.$debug.send` for the DevTools Debug tab. Off by default
  // in the broker so a production bundle cannot inject spoofed traffic;
  // the reference stand is a demo, so it stays on.
  debug: true,
});

async function main() {
  // ACL must be armed before any MFE tries to subscribe or send —
  // otherwise the first mount would slip through the guardrails.
  installAclHooks();

  renderChrome();
  // Lazy chunk — does not block the rest of the boot sequence.
  void mountDevTools();
  installBackendNotificationsRemote();
  installCrossTabCartRemote();
  await registerMicrofrontends();
}

void main();
