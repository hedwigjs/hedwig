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
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('cart');

bus.on('cart.add-item.v1', (msg) => { /* … */ });
await bus.emit('cart.snapshot.v1', snapshot); // a `state` topic — the runtime keeps the last one
const result = await bus.request('checkout', 'checkout.start.v1', payload); // answer typed by the contract
```

Three type parameters: `Topic` (the string union), `TopicPayloads`
(`topic → payload`) and `TopicContracts` (`topic → { kind, response? }`).
The third is optional; with it `emit()` accepts only events and state,
`request()` only requests, and `request()` infers its answer type from
the contract's `response`. Without it every topic is open to both verbs
and the answer type is passed explicitly: `request<K, R>(…)`.

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
| `createClient<T, P, C>(id, options?)` | A local participant. `options.onConflict`: `'throw'` (default, `CLIENT_ID_TAKEN` for a duplicate id) or `'reset'` (the existing client back, subscriptions dropped). |
| `createRemoteClient(id, options)` | A participant behind a transport (backend over WebSocket, iframe over postMessage, another tab, a worker). See the [runtime README](../broker/README.md#remote-clients) for identity modes and `accepts` / `forward`. |
| `whenRuntimeReady()` | Resolves with the runtime handle once one is registered — immediately when it already is. Rejects with `RUNTIME_TOO_OLD`. |
| `hasCapability(name)` | Feature detection: `transport.websocket`, `transport.message-port`, `wire.v1`, `remote.requests`, … `false` when there is no runtime yet. |
| `getRuntimeInfo()` | `{ abi, runtimeVersion, capabilities, sdkVersion, minRuntime }`, or `null` when no usable runtime is present. |
| `getRuntime()` / `tryGetRuntime()` | The `RuntimeHandle` with the gates applied — throwing (`RUNTIME_NOT_PROVIDED`, `RUNTIME_TOO_OLD`) or returning `undefined`. |
| `readHandle()` | The raw handle, no gates. For tooling. |
| `RUNTIME_KEY`, `ABI`, `RUNTIME_READY_EVENT` | The `globalThis` symbol, the ABI number (`1`) and the event name (`'hedwig:runtime-ready'`). See [The handle](#the-handle). |
| `SDK_VERSION`, `MIN_RUNTIME`, `compareVersions(a, b)` | This build's version, the oldest runtime it accepts (before 1.0: the runtime released with it), and the numeric semver compare behind the gate. |
| `LazyClient`, `DEFAULT_QUEUE_LIMIT` | The class `createClient()` returns before a runtime exists (`bound`, `queued` for diagnostics) and its queue bound (64). |
| `HedwigSdkError` | The error class; `code` is an `SdkErrorCode`. |
| `RoutingReason` | The closed set of delivery outcomes to switch on (`RoutingReasonType`). |
| types | `Client`, `ClientOptions`, `RemoteClient`, `RemoteClientOptions`, `RemoteIdentity`, `RemoteFrameRejectReason`, `Message`, `HandlerFn`, `MessageOptions`, `RequestOptions`, `ReplayOptions`, `BackpressureOptions`, `SubscriptionOptions`, `RoutingResult`, `Transport`, `TransportDescriptor`, `TransportKind`, `RuntimeHandle`, `RuntimeInfo`, `ClientMeta`, `TopicKind`, `TopicKindMap`, `TopicPolicy`, `TopicContractsMap`, `KindOf`, `EmitTopic`, `RequestTopic`, `ResponseOf`. |

## Errors

Every error carries a stable `code` (`SdkErrorCode`). The ones the SDK
raises itself are `HedwigSdkError` instances; the ones the runtime
raises through the handle are plain `Error`s with the same `code`
property.

| Code | When |
| --- | --- |
| `RUNTIME_NOT_PROVIDED` | No runtime in this realm (thrown by `createRemoteClient` and `getRuntime`; `createClient` proxies instead). |
| `RUNTIME_TOO_OLD` | The runtime is older than this SDK's `MIN_RUNTIME`. Thrown by `createClient` / `createRemoteClient` / `getRuntime`; `whenRuntimeReady` rejects. Update `@hedwigjs/broker` in the host. |
| `RUNTIME_ALREADY_PROVIDED` | Raised by the host's `initBroker()` when a handle for this ABI already exists but belongs to another provider. Not something a module sees. |
| `CLIENT_ID_TAKEN` | A local or remote client with this id exists (thrown by the runtime through the handle). |
| `TRANSPORT_UNSUPPORTED` | The descriptor `kind` is not in the runtime's capabilities. |
| `TRANSPORT_FANOUT` | Declared, not thrown today: a `request()` to a fan-out remote resolves `NACK TRANSPORT_FANOUT` instead. |

## The handle

`Symbol.for('@hedwigjs/runtime/1')` on `globalThis` — one symbol per ABI.
The runtime registers it in `initBroker()` and removes it in
`destroyBroker()`, and dispatches `hedwig:runtime-ready` on `globalThis`.
Every call through it carries `ClientMeta` (`{ sdkVersion, abi }`), which
the runtime reports as `sdkVersion` on `client.registered` and in
`inspect.getClients()`. Hygiene, not security: anything in the realm could
reach the runtime through the module graph anyway.

## Framework adapters

[`@hedwigjs/react`](../react) and [`@hedwigjs/vue`](../vue) bind a client
to the component lifecycle (`useClient`, `useTopic`, `useStateTopic`,
`useRequest`, `useRemoteClient`, `useRuntimeReady`). Both are optional and
build on this package only; a module-scope client created here can be
turned into argument-free hooks with `bindHooks(bus)` /
`bindComposables(bus)`.
