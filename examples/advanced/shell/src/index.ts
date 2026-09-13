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
  // The contracts registry as the runtime needs it: every topic's kind and,
  // where a contract declares it, `retention`. `state` topics (the cart
  // snapshot) keep their last value for every new subscriber; events with
  // `retention.last` (notifications, the chat transcript) keep that many
  // for subscribers that ask for `replay`. Nothing else to set up here —
  // what is retained is the registry's call; the host could only cap it
  // (`history.maxPerTopic`, `history.ttl`).
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
