# Getting started

Two packages, two roles. The **host** — your shell, container app, whatever
boots first — starts the runtime once. Every **module** creates its own client
from the SDK and never imports the runtime.

```bash
npm i @hedwigjs/broker          # the host
npm i @hedwigjs/client          # every module
```

## 1. Declare the topics

A topic's contract says what it is: an `event` (a fact, fan-out), a `request`
(a call to one recipient that answers) or `state` (a current value the runtime
keeps for whoever subscribes later).

```ts
// @my-org/topics
export type Topic = 'cart.snapshot.v1' | 'checkout.submit.v1';

export type TopicPayloads = {
  'cart.snapshot.v1': { items: CartItem[]; total: number };
  'checkout.submit.v1': { items: CartItem[] };
};

export type TopicContracts = {
  'cart.snapshot.v1': { kind: 'state' };
  'checkout.submit.v1': { kind: 'request'; response: { orderId: string } };
};

export const TOPIC_KINDS = {
  'cart.snapshot.v1': 'state',
  'checkout.submit.v1': 'request',
} as const;
```

Hand-written above so you can see the shape. In practice
[`npm create @hedwigjs/registry`](https://github.com/hedwigjs/hedwig/blob/main/packages/create-registry/README.md)
scaffolds a package with one file per topic and generates all four from it —
and [other sources work too](/guides/bring-your-own-contracts): Zod, Protobuf, GraphQL.

## 2. Boot the runtime, once

```ts
// host
import { initBroker } from '@hedwigjs/broker';
import { TOPIC_KINDS } from '@my-org/topics';

initBroker({ topics: TOPIC_KINDS });
```

That is the whole setup. `TOPIC_KINDS` tells the runtime each topic's kind and
what it retains; nothing else is required.

## 3. Talk

Every module creates a client with its own id. The id is how other modules
address it, and what the ACL hooks and DevTools show.

::: code-group

```ts [TypeScript]
import { createClient } from '@hedwigjs/client';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('cart-mfe');

// state: the retained value arrives inside on(), no re-send from the producer
const off = bus.on('cart.snapshot.v1', (msg) => render(msg.data));

// request: the answer is typed by the contract
const result = await bus.request('checkout-mfe', 'checkout.submit.v1', { items });
if (result.status === 'ACK') showOrder(result.data.orderId);

off(); // unsubscribe
```

```tsx [React]
// clients/bus.ts — one client per module, hooks bound to it once
import { createClient } from '@hedwigjs/client';
import { bindHooks } from '@hedwigjs/react';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('cart-mfe');
export const { useStateTopic, useTopic, useRequest } = bindHooks(bus);

// any component — no client argument, no useEffect, no unsubscribe
function Cart() {
  const cart = useStateTopic('cart.snapshot.v1');
  const submit = useRequest('checkout-mfe', 'checkout.submit.v1');

  return (
    <button disabled={submit.pending} onClick={() => void submit.send({ items: cart?.items ?? [] })}>
      Check out
    </button>
  );
}
```

```vue [Vue]
<!-- clients/bus.ts: bindComposables(bus) exports the same three -->
<script setup lang="ts">
import { useStateTopic, useRequest } from '../clients/bus';

const cart = useStateTopic('cart.snapshot.v1');            // shallowRef
const submit = useRequest('checkout-mfe', 'checkout.submit.v1');
</script>

<template>
  <button :disabled="submit.pending.value" @click="submit.send({ items: cart.value?.items ?? [] })">
    Check out
  </button>
</template>
```

:::

## Boot order does not matter

A module that calls `createClient` before the host called `initBroker()` gets a
client that records subscriptions and queues calls, then flushes them in order
the moment the runtime appears. Nothing to await, nothing to guard.

Modules depend on `@hedwigjs/client` only. The SDK finds the runtime through a
handle on `globalThis`, so Module Federation does not have to share the broker
package, and two copies of the library on one page still meet on one instance.

## Reach past the browser tab

A participant on the other side of a boundary joins as a **remote client**. The
host registers it once; senders keep calling the same three methods.

```ts
import { createRemoteClient } from '@hedwigjs/broker';

createRemoteClient('notifications-backend', {
  transport: { kind: 'websocket', socket: new WebSocket(url) },
  accepts: ['notification.*'],        // what it may inject into this realm
  forward: ['cart.snapshot.v1'],      // what it receives from this realm
});
```

Built-in transports: `postmessage`, `message-port`, `broadcast-channel`,
`websocket`, `sse`. Anything else implements three methods — see the
[transport conformance kit](https://github.com/hedwigjs/hedwig/blob/main/packages/broker/README.md#custom-transports).
What crosses the wire is [specified](/spec/), so a backend in any language can
speak it.

## See what is happening

```tsx
import { MessageBrokerDevTools } from '@hedwigjs/devtools';
import { getBroker } from '@hedwigjs/broker';

<MessageBrokerDevTools broker={getBroker()} enabled={import.meta.env.DEV} />
```

Messages with their kind, every client local and remote, what is retained for
late subscribers, and a separate stream for rejected sends and subscriptions.

## Next

- [Topic kinds and retention](/guides/contract-based-topics) — what `event`, `request` and
  `state` change, and how a topic keeps its last N messages.
- [Bring your own contracts](/guides/bring-your-own-contracts) — six ways to produce the types.
- [The wire](/spec/) — the envelope, delivery semantics, the threat model.
- [The reference stand](https://hedwigjs.com/demo/advanced/) — all of it running: seven modules, a
  backend over WebSocket and SSE, a cross-origin iframe, DevTools. The
  [source](https://github.com/hedwigjs/hedwig/tree/main/examples/advanced) walks
  through every part.
