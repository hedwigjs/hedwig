# @hedwigjs/client

The SDK a **module** uses to talk to the Hedwig runtime the **host** booted.
It depends on nothing at runtime and never boots a broker itself: it finds
the runtime through a handle on `globalThis`, checks that the runtime is new
enough for these types, and hands out clients.

```bash
npm i @hedwigjs/client
```

```ts
import { createClient } from '@hedwigjs/client';
import type { Topic, TopicPayloads } from '@my-org/topics';

export const bus = createClient<Topic, TopicPayloads>('cart');

bus.on('cart.add-item.v1', (msg) => { /* … */ });
await bus.emit('cart.snapshot.v1', snapshot); // a `state` topic — the runtime keeps the last one
const result = await bus.request<'checkout.start.v1', CheckoutStartResponse>('checkout', 'checkout.start.v1', payload);
```

## Why a separate package

A module's `package.json` should never pin the runtime's version: the host
owns `@hedwigjs/broker` and updates it on its own schedule. Modules bundle
this SDK freely — duplicates are harmless, it holds no state — and the
runtime's version stays invisible to them. Module Federation: the host does
**not** share `@hedwigjs/broker`; modules do not need it.

## Boot order does not matter

`createClient()` works before the host called `initBroker()`. It returns a
lazy proxy: `on()` records the subscription, `emit()` / `request()` queue
(bounded, 64 calls; overflow resolves the oldest with
`NACK RUNTIME_NOT_READY`), and everything flushes in order the moment the
runtime registers. `createRemoteClient()` is **not** proxied — a transport
needs a live runtime — so `await whenRuntimeReady()` first when the order is
not guaranteed.

## API

| Export | Purpose |
| --- | --- |
| `createClient(id, options?)` | A local participant. `options.onConflict`: `'throw'` (default, `CLIENT_ID_TAKEN` for a duplicate id) or `'reset'`. |
| `createRemoteClient(id, options)` | A participant behind a transport (backend over WebSocket, iframe over postMessage, another tab, a worker). See the runtime README for identity modes and `accepts` / `forward`. |
| `whenRuntimeReady()` | Resolves with the runtime handle once one is registered. |
| `hasCapability(name)` | Feature detection: `transport.websocket`, `transport.message-port`, `wire.v1`, `remote.requests`, … |
| `getRuntimeInfo()` | `{ abi, runtimeVersion, capabilities, sdkVersion, minRuntime }` or `null`. |
| `RoutingReason` | The closed set of delivery outcomes to switch on. |
| types | `Client`, `RemoteClient`, `Message`, `RoutingResult`, `Transport`, `TransportDescriptor`, options types. |

## Errors

Every SDK error is a `HedwigSdkError` with a stable `code`:

| Code | When |
| --- | --- |
| `RUNTIME_NOT_PROVIDED` | No runtime in this realm (thrown by `createRemoteClient`; `createClient` proxies instead). |
| `RUNTIME_TOO_OLD` | The runtime is older than this SDK's `MIN_RUNTIME`. Update `@hedwigjs/broker` in the host. |
| `CLIENT_ID_TAKEN` | A client with this id exists (thrown by the runtime through the handle). |
| `TRANSPORT_UNSUPPORTED` | The descriptor `kind` is not in the runtime's capabilities. |

## The handle

`Symbol.for('@hedwigjs/runtime/1')` on `globalThis` — one symbol per ABI.
The runtime registers it in `initBroker()` and removes it in
`destroyBroker()`, and dispatches `hedwig:runtime-ready` on `globalThis`.
Hygiene, not security: anything in the realm could reach the runtime through
the module graph anyway.
