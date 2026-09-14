# @hedwigjs/vue

Vue 3 composables that bind Hedwig clients to the component scope. Built on
[`@hedwigjs/client`](../client); no dependency on the runtime, no plugin to
install.

**Docs →** [hedwigjs.com](https://hedwigjs.com) · **Live demo →** [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)

```bash
npm i @hedwigjs/vue @hedwigjs/client
```

```vue
<script setup lang="ts">
import { useClient, useStateTopic, useRequest, useRemoteClient } from '@hedwigjs/vue';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

const bus = useClient<Topic, TopicPayloads, TopicContracts>('cart-ui');
const snapshot = useStateTopic(bus, 'cart.snapshot.v1', EMPTY);            // shallowRef, retained value right away
const status = useRequest(bus, 'notifications-backend', 'notification.status.v1');

const iframeWindow = ref<Window | null>(null);
useRemoteClient('checkout-iframe', () =>
  iframeWindow.value && {
    transport: { kind: 'postmessage', target: iframeWindow.value, allowedOrigins: [ORIGIN], targetOrigin: ORIGIN },
    accepts: ['checkout.completed.v1'],
  },
);
</script>

<template>
  <p>{{ snapshot.totalItems }} items</p>
  <button :disabled="status.pending.value" @click="status.send({ includeLang: true })">Ask the backend</button>
  <span>{{ status.result.value?.data?.connected }}</span>
</template>
```

## Composables

| Composable | Returns | Notes |
| --- | --- | --- |
| `useClient(id, options?)` | `Client` | Created synchronously in setup, destroyed on scope dispose. Third type parameter `TopicContracts` for kind-aware verbs. |
| `useTopic(client, topic, handler, options?)` | — | `client` may be a plain client, a ref, or a getter; the subscription follows it and ends with the scope. |
| `useStateTopic(client, topic, initial?)` | `ShallowRef` | Holds a `state` topic's retained value as soon as it returns when the runtime is already there (a lazy client fills it when it binds); updates on every emit. |
| `useRequest(client, recipient, topic, options?)` | `RequestHandle<D, R>` — `{ send, pending, result, reset }` | `pending` is a `Ref<boolean>`, `result` a `ShallowRef`; answer type `R` from the contract; `send` never rejects. `RequestHandle` is exported. |
| `useRemoteClient(id, options)` | `ShallowRef<RemoteClient \| null>` | `options` is a `MaybeRefOrGetter`: a plain options object, a ref, or a getter; `null` / `undefined` means no remote. Recreated when the source changes, destroyed on `null` and on dispose (transport closed, pending requests `REMOTE_GONE`). |
| `useRuntimeReady()` | `Ref<boolean>` | Whether the host's runtime exists yet. |
| `bindComposables(client)` | `BoundComposables` — `{ client, useTopic, useStateTopic, useRequest }` | The three data composables with `client` filled in — see below. `BoundComposables` is exported. |

## Bound composables: skip the client argument

A module with one client for its whole lifetime creates it once at module
scope and binds the composables to it; components then call them without
the client. Plain partial application, types unchanged.

```ts
// clients/bus.ts
import { createClient } from '@hedwigjs/client';
import { bindComposables } from '@hedwigjs/vue';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('menu');
export const { useStateTopic, useTopic, useRequest } = bindComposables(bus);
```

```vue
<script setup lang="ts">
import { useStateTopic, useRequest } from '../clients/bus';
const snapshot = useStateTopic('cart.snapshot.v1');
const status = useRequest('notifications-backend', 'notification.status.v1');
</script>
```

For a client owned by the scope (`useClient`) keep the unbound
composables and pass the client.

## Lifecycle rules

- A scope-owned client (`useClient`) is destroyed on scope dispose;
  subscriptions made through `useTopic` end with it. Module-scope clients
  (`export const bus = createClient(...)`) are not owned by any scope and
  stay.
- `useRemoteClient` calls `createRemoteClient` from `@hedwigjs/client`,
  which needs a live runtime: when no runtime exists it throws
  `RUNTIME_NOT_PROVIDED` — from `useRemoteClient()` itself when the options
  are present during setup (the watcher is immediate), otherwise from the
  watcher when the source first yields options. Gate it with
  `useRuntimeReady()` in modules that may mount before the host called
  `initBroker()`: return `null` from the getter until `ready.value` is
  `true`.
- A subscription denied by an `onSubscribe` hook throws from the watcher.

Works inside components and inside `effectScope()`; everything is released
with `onScopeDispose`.
