---
layout: home
hero:
  name: Hedwig
  text: Contract-first messaging for web modules
  tagline: One typed API for everything your app talks to — microfrontends, iframes, workers, other tabs, a backend over WebSocket or SSE.
  image:
    src: /hedwig-owl.png
    alt: Hedwig
  actions:
    - theme: brand
      text: Get started
      link: /guides/getting-started
    - theme: alt
      text: Live demo
      link: https://hedwigjs.com/demo/advanced/
      target: _blank
    - theme: alt
      text: GitHub
      link: https://github.com/hedwigjs/hedwig
features:
  - title: One API, every transport
    details: on, emit and request — the same three methods whether the other side is a module in this bundle, an iframe, a Worker, another tab or a service over WebSocket or SSE.
  - title: The contract decides the semantics
    details: A topic is an event, a request or a state value, declared once in its contract. The types enforce the verb, and the runtime keeps what the contract says to keep.
  - title: DevTools in the box
    details: Every message, every client local or remote, retained state, and a separate stream for security events — in a panel you mount in your own app.
  - title: React and Vue included
    details: Hooks and composables bound to the component lifecycle, so a subscription lives exactly as long as the component. React 18 and 19.
---

## What it looks like

The same module three times: a fact goes out to whoever listens, a current
value arrives without asking the producer to re-send it, and a targeted call
comes back typed.

::: code-group

```ts [TypeScript]
import { createClient } from '@hedwigjs/client';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

const cart = createClient<Topic, TopicPayloads, TopicContracts>('cart-mfe');

// A fact: everyone subscribed hears it.
cart.emit('user.viewed-menu.v1', { at: Date.now() });

// A current value: a late subscriber gets it inside on(), no re-send.
cart.on('cart.snapshot.v1', (msg) => render(msg.data));

// A targeted call: the answer is typed by the contract.
const result = await cart.request('checkout-mfe', 'checkout.submit.v1', snapshot);
if (result.status === 'ACK') showOrder(result.data.orderId);
```

```tsx [React]
// clients/bus.ts — one client per module, hooks bound to it once
export const bus = createClient<Topic, TopicPayloads, TopicContracts>('cart-mfe');
export const { useStateTopic, useRequest } = bindHooks(bus);

// any component — no client argument, no useEffect, no unsubscribe
function Cart() {
  const cart = useStateTopic('cart.snapshot.v1');            // there on the first paint
  const submit = useRequest('checkout-mfe', 'checkout.submit.v1');

  return (
    <button disabled={submit.pending} onClick={() => void submit.send(cart)}>
      Check out · {cart?.total ?? 0}
    </button>
  );
}
```

```vue [Vue]
<script setup lang="ts">
// clients/bus.ts: bindComposables(bus) exports the same three
import { useStateTopic, useRequest } from '../clients/bus';

const cart = useStateTopic('cart.snapshot.v1');            // shallowRef, filled right away
const submit = useRequest('checkout-mfe', 'checkout.submit.v1');
</script>

<template>
  <button :disabled="submit.pending.value" @click="submit.send(cart)">
    Check out · {{ cart?.total ?? 0 }}
  </button>
</template>
```

:::

The module above does not know where `checkout-mfe` runs. Same bundle, another
iframe, a Worker, a backend behind a WebSocket — the host wires that up once,
and the call site never changes.

## Who it is for

- An application assembled from **independently deployed frontend modules** —
  single-spa, Module Federation, or your own loader — that need to talk without
  importing each other.
- Anything with a **boundary in the browser**: a payment iframe on another
  origin, a Web or Service Worker, a second tab of the same app.
- A **backend that pushes into the same bus** over WebSocket or SSE and answers
  requests from the UI, with one wire format on both sides.

## Who it is not for

- A single React application that needs **state management**. Use a store.
- **Server-to-server** messaging. Use a real broker: NATS, Kafka, RabbitMQ.
- A page where two components sit next to each other and can simply **share a
  prop**. Nothing crosses a boundary there.
