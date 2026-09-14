# @hedwigjs/react

React hooks that bind Hedwig clients to the component lifecycle. Built on
[`@hedwigjs/client`](../client); no dependency on the runtime, no context
provider to install.

**Docs →** [hedwigjs.com](https://hedwigjs.com) · **Live demo →** [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)

```bash
npm i @hedwigjs/react @hedwigjs/client
```

## What it replaces

Every module used to write the same three things by hand: a `useState` +
`useEffect` pair per subscription, a `useRef` + two effects to keep a
remote client alive exactly as long as a modal, and `busy` / `result`
state under every button that sends a request.

```tsx
import { useClient, useStateTopic, useRequest, useRemoteClient } from '@hedwigjs/react';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

function Cart() {
  const bus = useClient<Topic, TopicPayloads, TopicContracts>('cart-ui');
  const snapshot = useStateTopic(bus, 'cart.snapshot.v1', EMPTY);   // retained value, before first paint if the runtime is up
  const status = useRequest(bus, 'notifications-backend', 'notification.status.v1');

  return (
    <>
      <p>{snapshot.totalItems} items</p>
      <button onClick={() => void status.send({ includeLang: true })} disabled={status.pending}>
        Ask the backend
      </button>
      {status.result?.data?.connected}
    </>
  );
}

function CheckoutModal({ iframeWindow }: { iframeWindow: Window | null }) {
  useRemoteClient(
    'checkout-iframe',
    iframeWindow && {
      transport: { kind: 'postmessage', target: iframeWindow, allowedOrigins: [ORIGIN], targetOrigin: ORIGIN },
      accepts: ['checkout.completed.v1'],
    },
    [iframeWindow],
  );
  …
}
```

## Hooks

| Hook | Returns | Notes |
| --- | --- | --- |
| `useClient(id, options?)` | `Client \| null` | Created in a layout effect (StrictMode-safe: never two clients with one id), destroyed on unmount, `null` on the first render. Pass `TopicContracts` as the third type parameter for kind-aware verbs. |
| `useTopic(client, topic, handler, options?)` | — | Subscribed while mounted; the latest handler is always called; re-subscribes only when `client` / `topic` change. Accepts a module-scope client too. |
| `useStateTopic(client, topic, initial?)` | the value | A `state` topic's retained value is delivered synchronously inside `on()` and the subscription runs before paint — no flash of `initial` when the runtime is already there at mount. With a lazy client (created before `initBroker()`) the value lands when it binds, after the first paint. |
| `useRequest(client, recipient, topic, options?)` | `RequestHandle<D, R>` — `{ send, pending, result, reset }` | Answer type `R` from the contract. Results arriving after unmount are dropped. `send` before the client exists resolves `NACK RUNTIME_NOT_READY`. `RequestHandle` is exported. |
| `useRemoteClient(id, options \| null, deps?)` | `RemoteClient \| null` | Created when options are present, recreated when `deps` change, destroyed on cleanup (transport closed, pending requests `REMOTE_GONE`). |
| `useRuntimeReady()` | `boolean` | Whether the host's runtime exists yet. |
| `bindHooks(client)` | `BoundHooks` — `{ client, useTopic, useStateTopic, useRequest }` | The three data hooks with `client` filled in — see below. `BoundHooks` is exported. |

## Bound hooks: skip the client argument

Most modules have one client for their whole lifetime, created once at
module scope. Passing it to every hook is noise. `bindHooks` closes over
the client (plain partial application) and returns the same hooks
without the first argument; the types are unchanged.

```ts
// clients/bus.ts — once per module
import { createClient } from '@hedwigjs/client';
import { bindHooks } from '@hedwigjs/react';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('menu');
export const { useStateTopic, useTopic, useRequest } = bindHooks(bus);
```

```tsx
// any component of the module
import { useStateTopic, useRequest } from '../clients/bus';

const snapshot = useStateTopic('cart.snapshot.v1');                        // no client argument
const status = useRequest('notifications-backend', 'notification.status.v1');
```

Every member of the returned object is a real hook (call it at the top
level of a component). Use the bound form for module-scope clients; a
client owned by a component through `useClient` changes with the
component, so keep passing it to the unbound hooks there.

## Lifecycle rules

- A hook-owned client is destroyed on unmount; subscriptions made through
  `useTopic` are removed with it. Module-scope clients (`export const bus =
  createClient(...)`) are not owned by any component and stay.
- A subscription denied by an `onSubscribe` hook throws from the effect —
  handle it with an error boundary.
- `useRemoteClient` throws `RUNTIME_NOT_PROVIDED` from its effect when no
  runtime exists; gate it with `useRuntimeReady()` in modules that may mount
  first.
