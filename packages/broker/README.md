# @hedwigjs/broker

Runtime broker for the Hedwig messaging toolkit. One typed API for
event, request and state topics across modules — in-process,
cross-frame, cross-tab, and cross-process — with hooks and
observability built in.

This package is for the **host**: it boots the runtime. Modules talk
to that runtime through [`@hedwigjs/client`](../client), a small SDK
with no dependency on this package. See
[Host and modules](#host-and-modules).

```bash
npm install @hedwigjs/broker
```

> Pre-release. The public surface documented here is stable across
> the pre-release; anything marked *internal* may change.

**Live demo →** [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced) · **Full project docs →** [`../..#readme`](../..#readme)

---

## Table of contents

- [Quickstart](#quickstart)
- [Core concepts](#core-concepts)
- [Host and modules](#host-and-modules)
- [API reference](#api-reference)
  - [Broker facade](#broker-facade)
  - [One broker per realm](#one-broker-per-realm)
  - [Client](#client)
  - [Broker extension surface](#broker-extension-surface)
- [Message shape](#message-shape)
- [RoutingResult](#routingresult)
- [Remote clients](#remote-clients)
- [Custom transports](#custom-transports)
- [Wire format](#wire-format)
- [Hooks](#hooks)
  - [When a hook throws](#when-a-hook-throws)
- [Topic kinds and state](#topic-kinds-and-state)
- [Message history & replay](#message-history--replay)
- [Backpressure](#backpressure)
- [System events](#system-events)
- [Inspector](#inspector)
- [Recipes](#recipes)
- [Performance](#performance)
- [TypeScript — bring your own contracts](#typescript--bring-your-own-contracts)
- [License](#license)

---

## Quickstart

The host boots the runtime once. Each module creates a typed client
from `@hedwigjs/client`, subscribes and emits. Neither side imports
the other's package.

```ts
// Contracts — hand-written here. `@hedwigjs/create-registry` generates
// the same three types plus TOPIC_KINDS from one file per topic.
type Topic = 'cart.item-added.v1' | 'cart.get-total.v1';
type TopicPayloads = {
  'cart.item-added.v1': { sku: string; qty: number };
  'cart.get-total.v1': void;
};
type TopicContracts = {
  'cart.item-added.v1': { kind: 'event' };
  'cart.get-total.v1': { kind: 'request'; response: number };
};
const TOPIC_KINDS = {
  'cart.item-added.v1': 'event',
  'cart.get-total.v1': 'request',
} as const;
```

```ts
// Host (the shell) — once. The runtime learns each topic's kind, and
// what it keeps for late subscribers, from TOPIC_KINDS.
import { initBroker } from '@hedwigjs/broker';

initBroker({ topics: TOPIC_KINDS });
```

```ts
// Module — in any order relative to the host: a client created before
// initBroker() queues its calls and flushes them when the runtime appears.
import { createClient } from '@hedwigjs/client';

const cart = createClient<Topic, TopicPayloads, TopicContracts>('cart');

cart.on('cart.item-added.v1', (msg) => {
  console.log('added', msg.data.sku, '×', msg.data.qty);
});
void cart.emit('cart.item-added.v1', { sku: 'CROISSANT', qty: 2 });

// Request → typed answer. The handler's return value is the answer.
cart.on('cart.get-total.v1', () => 12.5);

const analytics = createClient<Topic, TopicPayloads, TopicContracts>('analytics');
const result = await analytics.request('cart', 'cart.get-total.v1', undefined);
// result.status === 'ACK', result.data === 12.5 — typed number, from the contract
```

Topic names, payload shapes and answer types come from the three type
parameters. With `TopicContracts` the verbs are kind-aware: `emit()` on
a request topic, or `request()` on an event topic, is a compile error.
Rename a topic in one place — TypeScript lights up every subscriber and
emitter that has drifted.

---

## Core concepts

- **Message** — one typed unit that travels through the broker: a
  `topic` + `data` payload + routing metadata (`source`, `target`,
  `id`, `timestamp`).
- **Topic** — a versioned string like `'cart.item-added.v1'`. Every
  topic maps to exactly one payload type in the `TopicPayloads` map.
- **Module (client)** — any participant in the communication graph.
  Each module obtains its own `Client` from `createClient(id)` in
  `@hedwigjs/client` and uses it for the full lifecycle of that module.
  Client ids are unique within a realm.
- **Kind** — what a topic *is*, declared once in its contract: an
  `event` (a fact, fan-out), a `request` (a command to one recipient
  that answers) or `state` (a current value the runtime keeps for late
  subscribers). See [Topic kinds and state](#topic-kinds-and-state).
- **Broker** — the singleton runtime returned by `initBroker(config)`.
  Owns the routing plane, the hook chain, the retention buffers, and the
  remote clients. In-process by default; remote clients extend it
  across contexts.
  One instance per realm, even if the library is bundled more than once
  on the page — see [One broker per realm](#one-broker-per-realm).
- **Remote client** — a participant whose code runs on the far side of a
  transport (postMessage, WebSocket, BroadcastChannel, …). Locally a
  proxy: its `forward` patterns are its subscriptions, `accepts` names
  what it may inject; inbound frames enter the same pipeline as
  `fromExternal: true` with `via` set to the remote's id.
- **Two verbs** — `emit()` for fan-out (events and state), `request()`
  for a targeted call awaiting a typed answer. Retention and replay are
  layered on top of `emit()` by the topic's contract, not a third verb.

The broker is **contract-first**: topics and payloads are described in
TypeScript, and the runtime is a thin executor over that contract.

---

## Host and modules

Two packages, one runtime:

| Package | Who installs it | What it does |
| --- | --- | --- |
| `@hedwigjs/broker` | the host (shell) only | Boots the runtime (`initBroker`); owns hooks, remote clients, observability. |
| `@hedwigjs/client` | every module | `createClient`, `createRemoteClient`, `whenRuntimeReady`, `hasCapability`, `getRuntimeInfo` and every public type. No runtime code, no state — safe to bundle in each module. |

`@hedwigjs/broker` depends on `@hedwigjs/client` and re-exports its
types, so host code has one import path. It also exports its own
`createClient` for host-side clients; modules should not use it.

**The handle.** `initBroker()` registers a small `RuntimeHandle`
(`{ abi, runtimeVersion, capabilities, createClient, createRemoteClient }`)
on `globalThis` under `Symbol.for('@hedwigjs/runtime/1')` — exported as
`RUNTIME_KEY`, one symbol per `ABI` (currently `1`) — and dispatches
`RUNTIME_READY_EVENT` (`'hedwig:runtime-ready'`) on `globalThis`.
`destroyBroker()` removes the handle. The SDK reaches the runtime
through that handle, never through the module graph, so the host's
copy of this package is the only one that matters. The handle is
non-enumerable and non-writable; like the realm slot below it is
hygiene, not a security boundary.

**Boot order does not matter.** `createClient()` from the SDK works
before the host called `initBroker()`: it returns a `LazyClient` that
records `on()` calls and queues `emit()` / `request()` — bounded by
`DEFAULT_QUEUE_LIMIT` (64); on overflow the oldest call resolves
`NACK RUNTIME_NOT_READY` — then flushes everything in order the moment
a runtime registers. Modules can create their client at module scope.
`createRemoteClient()` is not proxied — a transport needs a live
runtime — so `await whenRuntimeReady()` first when the order is not
guaranteed.

**Errors.** The SDK throws `HedwigSdkError` with a stable `code`;
errors the runtime raises through the handle are plain `Error`s with
the same `code` property.

| Code | Thrown by | When |
| --- | --- | --- |
| `RUNTIME_NOT_PROVIDED` | SDK | No runtime in this realm: `createRemoteClient()`, `getRuntime()`. `createClient()` returns a lazy client instead. |
| `RUNTIME_TOO_OLD` | SDK | The runtime's version is below the SDK's `MIN_RUNTIME`. Raised by `createRemoteClient()` / `getRuntime()`; `whenRuntimeReady()` rejects; `createClient()` returns a blocked client that answers `NACK RUNTIME_TOO_OLD` instead of throwing at module scope. Update `@hedwigjs/broker` in the host. |
| `RUNTIME_ALREADY_PROVIDED` | `initBroker()` | A handle for this ABI already exists in the realm but was not created through this package's realm slot — another provider of the runtime. One host boots one runtime. |
| `CLIENT_ID_TAKEN` | runtime | `createClient()` / `createRemoteClient()` with an id that is in use. Local and remote clients share one namespace. See `ClientOptions.onConflict` under [Client](#client). |
| `TRANSPORT_UNSUPPORTED` | runtime | A descriptor `kind` this runtime does not provide. `hasCapability('transport.<kind>')` tells ahead. |

(`TRANSPORT_FANOUT` is also declared in `SdkErrorCode` but is not
thrown today; a request to a fan-out remote resolves with the routing
reason of the same name instead.)

**What the runtime knows about a module.** Every SDK call carries
`ClientMeta` (`{ sdkVersion, abi }`). The runtime surfaces it as
`sdkVersion?` on the `client.registered` system event and on
`inspect.getClients()` — absent for clients created by host code and
for remote clients.

**Module Federation.** Do not share `@hedwigjs/broker`; the runtime is
private to the host. Modules bundle `@hedwigjs/client` themselves
(stateless, tiny — duplicates are harmless) and reach the runtime
through the handle. Nothing to pin, nothing to align.

**Framework adapters.** [`@hedwigjs/react`](../react) (`useClient`,
`useTopic`, `useStateTopic`, `useRequest`, `useRemoteClient`,
`useRuntimeReady`, `bindHooks`) and [`@hedwigjs/vue`](../vue) (the same
six as composables, plus `bindComposables`) bind clients to the
component lifecycle. Both build on `@hedwigjs/client` only.

---

## API reference

### Broker facade

```ts
import {
  initBroker,
  getBroker,
  createClient,
  createRemoteClient,
  destroyBroker,
} from '@hedwigjs/broker';
```

| Function | Purpose |
| --- | --- |
| `initBroker<T, P>(config?)` | Boot the runtime once and register the SDK handle. Returns the existing instance when this realm already has one from a compatible copy of the library; throws `RUNTIME_ALREADY_PROVIDED` when a foreign runtime holds the handle. |
| `getBroker<T, P>()` | The current broker without holding the `initBroker` reference. Throws if not booted. |
| `createClient<T, P, C>(id, options?)` | A typed `Client` for host code. A taken id throws `CLIENT_ID_TAKEN` unless `options.onConflict === 'reset'`, which returns the existing client with its subscriptions dropped. Modules use `createClient` from `@hedwigjs/client` instead. |
| `createRemoteClient(id, options)` | Shorthand for `getBroker().createRemoteClient(id, options)`. See [Remote clients](#remote-clients). |
| `destroyBroker()` | Tear down remote clients, subscriptions, retention buffers, hooks and the client registry; remove the SDK handle. |

`BrokerConfig`:

```ts
{
  topics?: TopicKindMap; // TOPIC_KINDS from the registry: kinds, and what each topic retains
  history?: {            // host-side caps only — what is retained comes from `topics`
    enabled?: boolean;   // default true; false switches event retention off (state unaffected)
    maxPerTopic?: number;// cap on any contract's `retention.last`
    ttl?: number;        // ms, expire retained events; state values never expire
  };
  logger?: BrokerLogger; // see "Logger" below
  debug?: boolean;       // arms broker.$debug.send — default false
  hooks?: { failMode?: 'open' | 'closed' }; // default 'closed' — see "When a hook throws"
  request?: { timeout?: number };           // default timeout for every request()
}
```

`TopicKindMap` entries are a bare kind (`'event' | 'request' | 'state'`)
or a `TopicPolicy` (`{ kind, retention?: { last } }`); `retention` only
applies to events, a `state` topic always keeps exactly its last value.

`initBroker()` works in non-secure contexts too (plain `http://`
staging and intranet hosts): message ids are built from
`crypto.randomUUID` where available and from `crypto.getRandomValues`
otherwise, so the broker never depends on an `https:` origin.

### One broker per realm

"One broker" is guaranteed per **realm** — one window or worker — not
per copy of the library. The instance lives in a non-enumerable slot on
`globalThis` (`Symbol.for('@hedwigjs/broker')`) together with the
package version of the copy that created it, so every copy of
`@hedwigjs/broker` that ends up on the page resolves to the same core:

- a module that bundled the runtime by mistake (it should depend on
  `@hedwigjs/client` only);
- two applications built by different bundlers on one page;
- the ESM + CJS dual-package hazard (`import` in one module, `require`
  in another).

The first time a copy adopts an instance it did not create, the broker
logs `broker.duplicate_copy` and emits the same-named system event, so
the duplication is visible in DevTools instead of silent. Everything
still talks on one bus.

Compatibility follows semver: before 1.0 copies must share the same
**minor**, from 1.0 on the same **major** (`isCompatibleVersion` is
exported). An incompatible copy never gets its own broker — its
`initBroker()`, `getBroker()` and `createClient()` throw with a message
naming both versions, and the core logs `broker.version_incompatible`.
Two buses on one page is a configuration error, so it fails loudly.
The clean setup never raises the question: only the host depends on
`@hedwigjs/broker`, and it is not listed in Module Federation `shared`
at all — modules reach the runtime through the SDK handle (see
[Host and modules](#host-and-modules)).

Iframes and Workers are separate realms. They run their own
`initBroker()` and talk through a remote client (`{ kind: 'postmessage' }`,
`{ kind: 'message-port' }`);
do not reach for `parent.globalThis` to share an instance — a frame's
subscriptions would outlive the frame, and cross-realm objects break
`instanceof`.

`broker.version` and `broker.inspect.getVersionInfo()` expose the
diagnostics (version, duplicate copies adopted). This slot is hygiene,
not a security boundary: any
script in the realm could already reach the broker through the module
graph.

### Client

Returned by `createClient<Topic, TopicPayloads, TopicContracts>(id, options?)`
— from `@hedwigjs/client` in a module, from this package in host code.
The interface is the same either way: `Client<T, P, C>`.

| Method | Semantics |
| --- | --- |
| `on(topic, handler, options?)` | Subscribe. Returns an unsubscribe function for this handler. Options below. Throws if an `onSubscribe` hook rejects. |
| `off(topic)` | Remove every handler this client has on `topic`. No-op if not subscribed. |
| `emit(topic, data, options?)` | Broadcast to every subscriber of `topic` (event and state topics). Resolves with the aggregated `RoutingResult`. `MessageOptions` is currently empty: what is retained is decided by the contract, not at the emit site. |
| `request(recipient, topic, data, options?)` | Targeted call to one recipient (request topics). Resolves with `RoutingResult<R>`; `R` is inferred from the contract's `response`, or passed explicitly as `request<K, R>`. Answered by the recipient's first handler, bypassing its backpressure. `options.timeout` (ms) bounds the wait: `NACK TIMEOUT` on expiry, the handler keeps running. |
| `reset()` | Drop every subscription for this client; keep it registered. |
| `destroy()` | Unregister the client; the instance becomes inert. |
| `id` | The client id passed to `createClient`. |

`ClientOptions.onConflict` decides what happens when the id is already
registered. `'throw'` (default) raises `CLIENT_ID_TAKEN` — two modules
that pick the same id must not silently wipe each other's
subscriptions. `'reset'` returns the existing client with its
subscriptions dropped (HMR, re-mount); destroying the old client in the
HMR dispose hook is the cleaner option.

`SubscriptionOptions` — all opt-in and combinable:

```ts
{
  backpressure?: BackpressureOptions; // throttle | debounce | rateLimit — see "Backpressure"
  replay?: { limit?: number; since?: number; until?: number }; // retained events, oldest first
  noLocal?: boolean;   // default true: your own multicasts are not delivered to you
  retained?: boolean;  // state topics, default true: the last value on subscribe; ignored when `replay` is set
}
```

Handlers receive the full immutable `Message<T, P[T]>` — the payload
lives on `msg.data`. A handler's return value is captured on
`RoutingResult.data` for `request()` callers. Sync and async handlers
are both supported.

**Dispatch semantics.** Handlers run synchronously on the emitter's
stack, in registration order. The rules that follow from that:

- A handler that calls `emit()` runs the nested dispatch inline — other
  subscribers see the nested message *before* the outer one. Defer
  follow-up emits if ordering matters.
- Subscribing or unsubscribing from inside a handler is safe and
  behaves like DOM `EventTarget`: a handler unsubscribed mid-dispatch
  (by itself or by another handler) is not invoked if it hasn't run
  yet; a handler subscribed mid-dispatch starts with the *next*
  message.
- A throwing handler is logged (`handler.failed`) and isolated — the
  other subscribers still receive the message, and `emit()` resolves
  `ACK`. For `request()` the caller gets `NACK HANDLER_FAILED`.

### Broker extension surface

Returned by `initBroker()` / `getBroker()`.

| Member                                            | Kind          | Purpose                                                                                          |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `$systemEvents`                                   | push channel  | Subscribe to broker lifecycle events (clients, subscriptions, remote clients, rejections).       |
| `inspect`                                         | pull snapshot | Read-only view over clients (local and remote), subscriptions, history.                          |
| `$debug.send(source, topic, target, data)`        | internal      | Inject a synthetic message through the full pipeline. Marked `synthetic: true`. For DevTools & tests. Requires `initBroker({ debug: true })`, otherwise resolves `NACK DEBUG_DISABLED`; `$debug.enabled` reports the state. |
| `version`                                         | readonly      | Package version of the copy that created this core. See [One broker per realm](#one-broker-per-realm). |
| `createRemoteClient(id, options)`                 | wiring        | Register a participant behind a transport. See [Remote clients](#remote-clients).                |
| `getRemoteClient(id)`                             | wiring        | The remote client with that id, if any.                                                          |
| `capabilities`                                    | readonly      | `Set` of stable strings this runtime supports: `transport.<kind>` for each built-in transport, `wire.v1`, `remote.requests`. The SDK reads the same set (`hasCapability`). |
| `useBeforeSendHook(fn)`                           | extension     | Gate outgoing messages. Return `{ allowed: false, message }` to reject.                          |
| `useAfterSendHook(fn)`                            | extension     | Observe delivery outcomes. Receives the frozen message + `RoutingResult`.                        |
| `useOnSubscribeHook(fn)`                          | extension     | Gate subscriptions. Return `{ allowed: false, message }` to reject.                              |
| `destroy()`                                       | lifecycle     | Full shutdown. Remote clients destroyed, registries cleared, subsequent calls become no-op warnings. |

The `$` prefix marks broker-internal surfaces intended for tooling
(DevTools, tracing) — never for business code.

---

## Message shape

Every routed message has the same envelope:

```ts
interface Message<T extends string, P> {
  id: string;              // unique per message ("abc-42")
  topic: T;                // e.g. 'cart.item-added.v1'
  source: string;          // client id that emitted
  target: string;          // recipient id, or '*' for broadcast
  data: P;                 // typed payload
  timestamp: number;       // Date.now() at emit
  replayed?: boolean;      // true when delivered on subscribe: a retained event (replay) or a state topic's last value
  fromExternal?: boolean;  // true when injected by a remote client
  via?: string;            // id of that remote client (local-only, never on the wire)
  wireId?: string;         // the producer's frame id; (source, wireId) correlates across realms
  ext?: object;            // opaque wire extension block (traceparent, hedwig.*)
  synthetic?: boolean;     // true when injected via broker.$debug.send
}
```

Messages are deep-frozen before entering the pipeline, so one handler
cannot change what the next one sees. Two consequences worth knowing:

- **Freezing happens in place.** The object you pass as `data` is the
  object that gets frozen — there is no copy. If you emit a live store
  object, it is frozen afterwards; pass a snapshot when you need to
  keep mutating the original.
- **Binary data is exempt.** `ArrayBuffer`, `SharedArrayBuffer` and
  every typed array / `DataView` over them are skipped (they cannot be
  frozen) and stay mutable. Everything around them is still frozen.

Do not mutate `msg.data` in handlers; treat them as pure observers.

---

## RoutingResult

Every `emit` / `request` resolves with a `RoutingResult`:

```ts
{
  status: 'ACK' | 'NACK';
  reason: RoutingReasonType;
  message: string;          // human-readable
  timestamp: number;
  recipientId?: ClientID;   // unicast (request)
  recipientIds?: ClientID[]; // multicast (emit)
  data?: TResponse;         // handler return value (request only)
}
```

`RoutingReason` values:

| Reason | Meaning |
| --- | --- |
| `DELIVERED` | Unicast: the recipient's handler ran and returned. |
| `DISPATCHED` | Multicast: handed to every current subscriber. |
| `REPLAY_DELIVERED` | Delivered during `on()` from the retention buffer, or a state topic's last value. Seen by `afterSend` hooks; never the result of an `emit()`. |
| `HOOK_REJECTED` | A `beforeSend` hook denied the message — or threw, under `hooks.failMode: 'closed'`. |
| `NO_SUBSCRIBERS` | Multicast with nobody subscribed. |
| `NOT_SUBSCRIBED` | Unicast: the recipient has no handler for the topic. |
| `HANDLER_FAILED` | The handler threw. The error is logged; `request()` resolves `NACK`. |
| `BROKER_DESTROYED` | The runtime was shut down — at call time, or while a request to a remote was pending. |
| `DEBUG_DISABLED` | `$debug.send` on a broker booted without `debug: true`. |
| `TIMEOUT` | `request()`: no answer within `timeout`. The handler (local or remote) may still run; it is not cancelled. |
| `TRANSPORT_ONE_WAY` | `request()` to a remote client whose transport is inbound-only (`sse`). |
| `TRANSPORT_FANOUT` | `request()` to a remote client on a fan-out transport (`broadcast-channel`). |
| `REMOTE_GONE` | `request()` to a remote client that was destroyed while waiting, or whose transport could not carry the frame. |
| `SERIALIZATION_FAILED` | A handler's return value could not be encoded for the wire. |
| `RUNTIME_NOT_READY` | SDK only: the call was queued before a runtime existed and dropped from a full queue, or the client was destroyed before a runtime appeared. |

The full enum is exported as `RoutingReason` for exhaustive `switch`
statements.

---

## Remote clients

Anything that lives behind a wire — a backend over WebSocket, an iframe
over `postMessage`, another tab over `BroadcastChannel`, a Worker over a
`MessagePort` — joins the broker as a **remote client**. It is a client
like any other: it has an id, it subscribes (`forward`), it sends
(`accepts`), and the same hooks and ACL rules apply to it.

```ts
import { createRemoteClient } from '@hedwigjs/broker'; // in a module: from '@hedwigjs/client'

const backend = createRemoteClient('notifications-backend', {
  transport: { kind: 'websocket', socket },
  accepts: ['notification.*'],          // what it may inject
});

const iframe = createRemoteClient('checkout-iframe', {
  transport: {
    kind: 'postmessage',
    target: iframeEl.contentWindow!,
    allowedOrigins: ['https://checkout.example.com'],   // inbound trust boundary
    targetOrigin: 'https://checkout.example.com',       // never '*'
  },
  accepts: ['checkout.completed.v1'],
});
iframe.forward('cart.*');               // its subscriptions; goes through onSubscribe hooks

iframe.destroy();                       // closes the transport, unregisters
```

`RemoteClientOptions`: `transport` (a descriptor or a custom
`Transport`), `identity` (default `{ mode: 'fixed' }`), `accepts`
(default none — every inbound frame is dropped), `forward` (initial
patterns), `maxBytes`, `rateLimit: { max, window }` and `timeout` (the
default for requests to this remote).

The returned `RemoteClient`:

| Member | Meaning |
| --- | --- |
| `id`, `kind`, `identity` | The id, the transport kind (`'custom'` for a `Transport` object), the identity mode. |
| `duplex`, `fanout`, `requests` | Transport flags. `requests` is `duplex && !fanout`: whether the remote may be the recipient of a `request()`. |
| `ready` | Resolves when the transport can carry frames; outbound frames wait for it. |
| `pending` | Requests in flight to this remote. |
| `createdAt` | Unix ms when the remote was registered. |
| `forwardPatterns`, `acceptPatterns` | The remote's current subscriptions, and the topics it may inject. |
| `forward(pattern \| pattern[])` | Subscribe the remote to local topics. Goes through `onSubscribe` hooks with the remote's id and throws on denial. Returns an unsubscribe. |
| `accept(pattern \| pattern[])` | Extend `accepts` at runtime. Returns a remover. |
| `destroy()` | Close the transport, unregister, fail pending requests with `REMOTE_GONE`. Idempotent. |

Built-in transports are named by a **descriptor** and instantiated by
the runtime, so their code never ships in a module's bundle:

| `kind`              | Wire                                        | Flags                        | Descriptor fields                                  |
| ------------------- | ------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `postmessage`       | `window.postMessage` between window/iframe  | duplex                       | `target`, `allowedOrigins`, `targetOrigin` (all required) |
| `message-port`      | `MessagePort` (Worker, `MessageChannel`)    | duplex                       | `port`                                             |
| `websocket`         | An externally-constructed `WebSocket`       | duplex, `ready` on OPEN      | `socket`                                           |
| `sse`               | `EventSource`                               | inbound-only                 | `url`, `withCredentials?`, `eventName?`            |
| `broadcast-channel` | `BroadcastChannel` between same-origin tabs | duplex, fan-out              | `name`                                             |

An unknown `kind` throws `TRANSPORT_UNSUPPORTED`; `broker.capabilities`
lists what the runtime provides (`transport.websocket`, …).

**Identity** of inbound frames is decided on this side, never trusted
from the wire:

| `identity.mode`    | Use when                                             | Effect on a frame's `source`                                   |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------- |
| `fixed` (default)  | One participant behind the wire (backend, iframe)    | Empty or equal to the remote's id → accepted as the remote; anything else → `SOURCE_MISMATCH`. |
| `allow`            | A gateway multiplexing known services                | Must be in `sources`; otherwise `SOURCE_NOT_ALLOWED`.          |
| `prefix`           | A foreign realm with its own clients (tab, worker)   | Kept and prefixed: `tab:cart-store`. Cannot collide with a local id. |

**Edge protection** happens before any hook: `accepts` (topics the remote
may inject; everything else is `TOPIC_NOT_ACCEPTED`), `maxBytes`,
`rateLimit`, and a structural check of the frame. Every drop is
published as `remote.frame.rejected { reason }`.

**Requests across the wire.** `client.request(remote.id, topic, data)`
goes out as a `kind: 'request'` frame with a `correlationId` and a
`deadline`; the far side answers with a `kind: 'response'` frame over the
same transport and the promise resolves with its result. Every other
outcome is a `NACK` you can switch on:

| Reason | When |
| --- | --- |
| `TIMEOUT` | No response within `timeout` (per call → `RemoteClientOptions.timeout` → `BrokerConfig.request.timeout` → 5000 ms). The far side may still run it; retry is your call, keyed by the request `id`. |
| `REMOTE_GONE` | The remote was destroyed while waiting, or its transport could not carry the frame. |
| `BROKER_DESTROYED` | The broker was shut down while waiting. |
| `TRANSPORT_ONE_WAY` | The transport is inbound-only (`sse`). Refused immediately. |
| `TRANSPORT_FANOUT` | The transport reaches many peers (`broadcast-channel`). Refused immediately. |
| `HANDLER_FAILED`, `NOT_SUBSCRIBED`, `HOOK_REJECTED`, `SERIALIZATION_FAILED` | The far side said so. |

Requests **from** a remote (`kind: 'request'` frames) are routed to the
named local client and always answered over the same transport, hook
denials included. `request.forwarded`, `response.received`,
`request.timeout` and `response.sent` on `$systemEvents` are the
wire-level trace; the request's own `afterSend` carries the final result
with `via` set to the remote id. Local and remote clients share one id
namespace: a taken id throws `CLIENT_ID_TAKEN`.

---

## Custom transports

`Transport` is the extension point. Anything that satisfies its
three-method contract plugs in — WebRTC data channels, Service Worker
messaging, Electron IPC, custom protocols. Pass the instance instead of
a descriptor.

```ts
import type { Transport } from '@hedwigjs/broker';

class MyTransport implements Transport {
  readonly duplex = true;   // optional flags; defaults: duplex, not fan-out
  readonly fanout = false;
  #cb: ((frame: unknown) => void) | null = null;

  send(frame: unknown): void {
    myWire.publish(frame);
  }

  onMessage(cb: (frame: unknown) => void): () => void {
    this.#cb = cb;
    const off = myWire.subscribe((payload) => this.#cb?.(payload));
    return () => { off(); this.#cb = null; };
  }

  destroy(): void { this.#cb = null; myWire.close(); }
}

createRemoteClient('peer', { transport: new MyTransport(), accepts: ['sync.*'] });
```

Contract summary:

- **`send(frame)`** — hand a JSON-serialisable frame to the wire. If it
  throws, the runtime isolates the failure per remote: the message was
  already delivered locally, the caller's promise resolves normally,
  other remotes still receive it, and `remote.send.failed` fires.
- **`onMessage(cb)`** — called once at creation; return an unsubscribe.
  Identity and topic policy are enforced by the remote client, so the
  transport only needs to verify *where the bytes came from* (origin,
  connection) when the wire has such a notion.
- **`destroy()`** — release sockets, listeners, timers. Must be
  idempotent. The remote client owns the transport and calls this.
- Optional: `duplex` (`false` for inbound-only), `fanout` (`true` when
  one `send` reaches many peers — such a remote can never be asked),
  `ready` (a promise the runtime awaits before sending), `onClose(cb)`
  (lets the runtime destroy the remote when the wire is gone).

**Conformance.** `@hedwigjs/broker/conformance` is the list of checks
every transport must pass — the built-ins run it in this package's own
suite. Give it a factory that returns a *pair* (our end and the peer's
end, wired to each other) and feed the cases to your test runner:

```ts
import { transportConformance, createMemoryTransportPair } from '@hedwigjs/broker/conformance';

for (const c of transportConformance(() => myWiredPair())) test(c.name, c.run);
```

Cases: capability flags are well-typed; `ready` resolves; a frame arrives
as a valid envelope with id, topic and data intact; a burst of 25 frames
keeps its order; the reverse direction works when `duplex`; `send` on an
inbound-only transport does not throw; `onMessage`'s unsubscribe stops
delivery; `destroy` stops delivery, is idempotent and leaves `send`
harmless; `onClose` fires when the pair's `close()` cuts the wire.
`createMemoryTransportPair()` is the reference implementation and a handy
stand-in for a real wire in unit tests.

---

## Wire format

Everything that crosses a transport is a **wire envelope v1** frame —
specified in [`docs/content/spec/envelope-v1.md`](../../docs/content/spec/envelope-v1.md),
JSON Schema shipped as `@hedwigjs/broker/spec/envelope-v1.schema.json`.
A backend in any language needs no npm package: it produces plain JSON
that validates against the schema.

```jsonc
{ "v": 1, "id": "3f0c…", "origin": "backend-9a2e…", "kind": "event",
  "topic": "notification.show.v1", "source": "notifications-backend",
  "target": "*", "data": { … }, "timestamp": 1789238807425 }
```

- `origin` is the producer's session id; a frame that comes back stamped
  with this realm's own origin is dropped (`ECHO`).
- The producer's `id` is kept as `message.wireId`; `(source, wireId)`
  is the cross-realm correlation key. `ext` is passed through as
  `message.ext` (`ext.traceparent` for W3C trace context,
  `ext.hedwig.*` reserved).
- Missing `v` / `kind` are tolerated for one version; `v: 2` or an
  unknown `kind` is `UNSUPPORTED`.
- Exports for custom transports, TypeScript backends and tests — ingress
  uses the same code: `WIRE_VERSION` (`1`); `parseFrame(raw)`, the
  structural check (`{ ok: true, frame }` or
  `{ ok: false, reason: 'MALFORMED' | 'UNSUPPORTED' }`);
  `buildFrame(message, origin, { correlationId?, deadline? })`;
  `buildResponse({ id, origin, correlationId, topic, source, target, status, reason, message?, data?, details? })`;
  `WIRE_RESPONSE_REASONS`, the closed set a response may carry; and
  `toWireReason(reason)`, which maps a local routing reason onto that
  set (local-only reasons collapse to `HANDLER_FAILED` with
  `exact: false`). Types: `WireFrame`, `WireMessage`, `WireResponse`,
  `WireKind`, `WireResponseReason`, `WireExt`, `ParsedWireFrame`,
  `ParsedWireMessage`, `ParseResult`, `ParseFailure`.

---

## Hooks

Three hooks let adapters and plugins extend the broker without
touching internals. Register on the broker, receive an unregister
function.

### `useBeforeSendHook` — gate outgoing messages

Synchronous. Runs for every emit *and* for every frame injected by a
remote client (use `msg.fromExternal` / `msg.via` to distinguish). Return
`{ allowed: false, message }` to short-circuit; the emit resolves with
`NACK HOOK_REJECTED` and a `message.rejected` system event fires.

```ts
import { getBroker } from '@hedwigjs/broker';

getBroker().useBeforeSendHook((msg) => {
  if (msg.topic.startsWith('admin.') && msg.source !== 'shell') {
    return { allowed: false, message: 'admin.* is shell-only' };
  }
  return { allowed: true };
});
```

Typical uses: ACL / capability checks, schema validation, tracing
span injection, redaction.

### `useAfterSendHook` — observe outcomes

Fire-and-forget. Receives the frozen message and the final
`RoutingResult`. Exceptions are caught and logged.

```ts
getBroker().useAfterSendHook((msg, result) => {
  metrics.record(msg.topic, {
    ok: result.status === 'ACK',
    reason: result.reason,
    recipients: result.recipientIds?.length ?? (result.recipientId ? 1 : 0),
  });
});
```

Typical uses: metrics, structured logs, tracing exit, audit trail.

### `useOnSubscribeHook` — gate subscriptions

Synchronous. Called before a subscription is registered. Return
`{ allowed: false, message }` to reject — `client.on()` throws with
that message and a `subscription.rejected` system event fires.

```ts
getBroker().useOnSubscribeHook((topic, clientId) => {
  if (topic.startsWith('user.pii.') && !isTrustedClient(clientId)) {
    return { allowed: false, message: `${clientId} may not read PII` };
  }
  return { allowed: true };
});
```

Typical uses: role-based ACL on read paths, dev-time contract audits.

### When a hook throws

Guard hooks (`beforeSend`, `onSubscribe`) **fail closed** by default: a
hook that throws counts as a denial, so a crashing ACL never lets
traffic through. The message resolves `NACK HOOK_REJECTED` (subscribe
throws), and a `hook.failed` system event plus a `hook.failed` log line
say it was a crash, not a policy decision. Opt into the old behaviour
with `initBroker({ hooks: { failMode: 'open' } })` — the throwing hook
is then skipped. `afterSend` hooks are observers and are always
isolated.

---

## Topic kinds and state

A topic contract declares what the topic *is* (see
`@hedwigjs/create-registry`): an **event** (a fact, fan-out via `emit`), a
**request** (a command to one recipient that answers, via `request`) or
**state** (a current value). The SDK enforces the verbs at compile time
when a client is created with the registry's `TopicContracts`:

```ts
import { createClient } from '@hedwigjs/client';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

const bus = createClient<Topic, TopicPayloads, TopicContracts>('cart');
bus.emit('cart.snapshot.v1', snapshot);            // state — ok
bus.request('cart-store', 'cart.add-item.v1', …);  // request — answer type inferred
bus.emit('cart.add-item.v1', …);                   // compile error: a request cannot be emitted
```

The runtime learns the kinds from `initBroker({ topics: TOPIC_KINDS })`
— a `TopicKindMap`, each entry a bare kind or `{ kind, retention }` —
and treats **state** topics specially: the last multicast on each —
local or from a remote client — is kept and delivered to every new
subscriber synchronously inside `on()`, flagged `replayed: true` (MQTT's
retained message). Nothing at the emit site, no `replay` option at the
subscriber; pass `{ retained: false }` to `on()` for live updates only.
Retained values are listed by `inspect.getRetained()` and announced as
`state.retained` on `$systemEvents`. Requests are never recorded —
`RequestOptions` is `{ timeout }`.

---

## Message history & replay

Some events are worth keeping for a subscriber that arrives later: the
last ten notifications, a chat transcript, an activity feed. The topic's
**contract** says so — `retention: { last: N }` on an event — and the
runtime keeps that many, in a buffer of its own per topic. Nothing to
remember at the emit site, nothing to configure in the host: the
registry's `TOPIC_KINDS` already carries it. Events without `retention`
are not kept at all; most events do not need to be.

```ts
// registry: domains/notification/show.v1.ts
export default {
  name: 'notification.show.v1',
  kind: 'event',
  retention: { last: 10 },
  …
} satisfies TopicContract;

// host — as always
initBroker({ topics: TOPIC_KINDS });

// producer emits as usual — the runtime keeps the last 10
void backend.emit('notification.show.v1', { kind: 'info', title });

// late subscriber replays them, then goes live
panel.on(
  'notification.show.v1',
  (msg) => showToast(msg.data),
  { replay: { limit: 10 } },
);
```

Per-topic buffers mean a chatty topic can never push another topic's
messages out. A subscriber's `replay.limit` is bounded by the contract's
`last`. Replay on a topic that retains nothing is not an error — the
subscription is live — but the runtime logs `broker.replay.no_retention`
so the omission is visible.

Not kept, ever: requests (replaying a command would re-run it with
nobody waiting for the answer). Kept regardless of origin: a frame that
arrived from a remote client is retained like a local emit, because
replay is local and never goes back on the wire (see
[delivery semantics](../../docs/content/spec/delivery-semantics.md)).

The host can only limit what the registry asked for:

```ts
initBroker({
  topics: TOPIC_KINDS,
  history: {
    maxPerTopic: 100,  // cap any contract's `last`
    ttl: 60_000,       // expire retained events after a minute
    enabled: false,    // switch event retention off entirely (state is unaffected)
  },
});
```

The DevTools **Replay Buffer** tab lists every retaining topic with its
limit and current fill — `notification.show.v1 · event · 3 of 10` — so
what a late subscriber would get is never a guess. `inspect.getHistory()`
returns the retained entries, `inspect.getHistoryStats()` the table.

If all you need is "the latest value for late joiners", that is a
`state` topic (above): one value, handed to every new subscriber without
any option. Retention and state are the same mechanism with different
numbers.

Replayed messages carry `replayed: true` — handlers can tell historical
traffic apart from live traffic. Replay is best-effort against a
bounded buffer; do not rely on it as durable storage.

**Ordering.** Replay is synchronous: matching entries are delivered to
the handler *before* `on()` returns, oldest first. Two guarantees
follow:

- **Old before new.** Any live message emitted after `on()` returns
  arrives after every replayed entry. A late-mounted view never paints a
  stale snapshot over a fresh one.
- **No duplicates.** The history snapshot is taken on the subscriber's
  stack, so a message emitted after `on()` cannot be delivered both
  live and replayed.

Handlers are invoked in order but not awaited; an async handler that
rejects during replay is logged as `replay.handler.failed`.

**When to use.** Late-joining modules (an MFE that mounts after the
initial burst), UI resurrection (a modal that re-opens should see the
latest `state.v1` message), reconnection recovery.

**When NOT to use.** As an event log — the buffer is bounded and
in-memory. As a request/response mechanism — use `request()` for that.

---

## Backpressure

Backpressure shapes **event** consumption only. `request()` always
reaches the subscriber's original handler and is always answered — a
throttled, debounced or rate-limited subscription still responds to
every request immediately. (Earlier pre-releases resolved such a request
`ACK` with no data when the strategy dropped it.)

Per-subscription control over handler invocation rate. Three
strategies, mutually exclusive:

```ts
menuClient.on(
  'inventory.tick.v1',
  updateStock,
  { backpressure: { throttle: 100 } }, // ≤ 10 calls/sec
);

searchClient.on(
  'search.query.v1',
  runSearch,
  { backpressure: { debounce: 250 } }, // fire after 250 ms of quiet
);

telemetryClient.on(
  'metrics.event.v1',
  ingest,
  {
    backpressure: {
      rateLimit: { max: 1000, window: 1000 }, // ≤ 1k/sec, drop excess
      onDrop: (n) => log.warn(`dropped ${n} metrics events`),
    },
  },
);
```

| Strategy      | Behavior                                                                                     | Fit                                          |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `throttle`    | First call runs immediately; subsequent calls collapse into a trailing invocation each window. | Real-time charts, high-frequency progress    |
| `debounce`    | Every call resets a timer; only the last message runs after `debounce` ms of silence.        | Search-as-you-type, form validation          |
| `rateLimit`   | Allow `max` messages per `window` ms. Excess is dropped (lost). `onDrop` reports counts.     | Ingest protection, burst tolerance           |

The wrapper is on the hot path even when idle — bench
`07-backpressure-overhead` measures the per-call cost so you can
budget accordingly.

---

## System events

Broker-lifecycle signals published on `broker.$systemEvents`. Not
user messages — infrastructure telemetry.

| Event | Payload | Fired when |
| --- | --- | --- |
| `broker.duplicate_copy` | `{ version, copyVersion, copies, at }` | Another compatible copy of the library adopted this instance through the realm slot. Still one bus. |
| `client.registered` | `{ clientId, at, sdkVersion? }` | A client registered — local or remote. `sdkVersion` is the `@hedwigjs/client` version behind the call; absent for host-created clients and for remotes. |
| `client.unregistered` | `{ clientId, at }` | `client.destroy()`, a remote destroyed, or broker teardown. |
| `subscription.added` | `{ clientId, topic, options? }` | `client.on(topic, …)` succeeded, or `remote.forward(pattern)`. |
| `subscription.removed` | `{ clientId, topic }` | The last handler on `(client, topic)` went away: `off()`, the unsubscribe function, reset, destroy. |
| `subscription.rejected` | `{ clientId, topic, reason }` | An `onSubscribe` hook denied the subscription. The caller also gets a throw. |
| `state.retained` | `{ topic, messageId, at }` | A multicast on a `state` topic replaced the retained value. |
| `hook.failed` | `{ kind, failMode, error, topic?, messageId?, source?, clientId? }` | A hook threw. `kind` is `beforeSend` / `onSubscribe` / `afterSend`. Guard hooks deny under `failMode: 'closed'` (default) and are skipped under `'open'`; `afterSend` is always skipped. |
| `message.rejected` | `{ source, target, topic, reason }` | A `beforeSend` hook denied a message. The emit also resolves `NACK HOOK_REJECTED`. |
| `remote.created` | `{ remoteId, kind, identity, at }` | `createRemoteClient(id, …)`. `client.registered` fires too. |
| `remote.destroyed` | `{ remoteId, at }` | `remote.destroy()`, transport closed, or broker teardown. `client.unregistered` fires too. |
| `remote.frame.rejected` | `{ remoteId, reason, source?, topic? }` | An inbound frame was dropped at the edge before any hook: `MALFORMED`, `TOO_LARGE`, `RATE_LIMITED`, `UNSUPPORTED` (bad `v` / `kind`), `ECHO` (our own origin), `TOPIC_NOT_ACCEPTED`, `SOURCE_MISMATCH`, `SOURCE_NOT_ALLOWED`. `source` / `topic` are what the frame claimed. |
| `remote.send.failed` | `{ remoteId, topic, messageId, reason, error? }` | A frame could not be sent: the transport threw (`TRANSPORT_THREW`) or never became ready (`NOT_OPEN`). The message was delivered locally and the caller got a normal result. |
| `request.forwarded` | `{ remoteId, topic, messageId, correlationId, deadline? }` | A local `request()` to a remote left as a `kind: 'request'` frame. |
| `response.received` | `{ remoteId, topic, correlationId, status, reason, latencyMs }` | A `kind: 'response'` frame matched a pending request on that remote. |
| `request.timeout` | `{ remoteId, topic, correlationId, timeout }` | A pending request to a remote expired locally; the far side may still run it. |
| `response.sent` | `{ remoteId, topic, correlationId, status, reason }` | A request that arrived from a remote was answered over the same transport. |

The emitter has `on(name, fn)`, `once(name, fn)`, `off(name?)`,
`onAny(fn)` and `listenerCount(name?)`. `on()` takes an exact event
name — there are no wildcard patterns; `onAny()` is the unified feed.

```ts
const off = getBroker().$systemEvents.on('message.rejected', (evt) => {
  console.warn('blocked by ACL:', evt);
});

// Or subscribe to everything for a unified feed:
const offAll = getBroker().$systemEvents.onAny((event, payload) => {
  ring.push({ event, payload, at: Date.now() });
});
```

Listeners are fire-and-forget; exceptions are caught and logged, never
propagated back into the pipeline.

---

## Inspector

Point-in-time state snapshots on `broker.inspect`. Pair with
`$systemEvents` to build accurate initial state without races:
snapshot first, then subscribe.

```ts
const inspect = getBroker().inspect;

inspect.getClients();             // ClientInfo[] — local and remote clients
inspect.getSubscribedClientIds(); // ids with at least one subscription
inspect.getRetained();            // RetainedState[] — the last value of every state topic emitted so far
inspect.getHistory();             // HistoryEntry[] — every retained message, oldest → newest
inspect.getHistoryStats();        // HistoryStats & { enabled }
inspect.getVersionInfo();         // { version, duplicateCopies }
```

`ClientInfo`:

```ts
{
  id: string;
  connectedAt: number;             // Unix ms
  sdkVersion?: string;             // @hedwigjs/client version, when created through the SDK
  subscriptions: Array<{
    topic: string;
    options?: SubscriptionOptions; // the first handler's options on this (client, topic)
    handlerCount: number;          // handlers this client has on the topic; 0 for remotes
  }>;                              // local: topics with handlers; remote: its `forward` patterns
  remote?: {                       // remote clients only
    kind: string; identity: 'fixed' | 'allow' | 'prefix';
    duplex: boolean; fanout: boolean; requests: boolean;
    accepts: string[]; pending: number;
  };
}
```

`getHistoryStats()` returns `{ count, topics, enabled, oldestTimestamp?,
newestTimestamp?, memoryUsage? }`: `topics` holds one `RetentionInfo`
per retaining topic — `{ topic, kind: 'event' | 'state', limit, count }`
— and `enabled` is the host's `history.enabled`. A `HistoryEntry` is
`{ message, timestamp, sequence }`; a `RetainedState` is
`{ topic, message, at }`.

All array returns are `ReadonlyArray` — mutating them will not affect
broker state. This is the API `@hedwigjs/devtools` reads on the pull
path.

---

## Recipes

### Idiomatic module setup

```ts
// modules/cart/src/client.ts
import { createClient } from '@hedwigjs/client';
import type { Topic, TopicPayloads, TopicContracts } from '@your-app/registry';

export const cartClient = createClient<Topic, TopicPayloads, TopicContracts>('cart');

// HMR: free the id before this file is re-evaluated (Vite: import.meta.hot).
if (module.hot) module.hot.dispose(() => cartClient.destroy());
```

One client per module, created at module scope — whether the host has
called `initBroker()` yet does not matter. Import it wherever the
module needs to talk to others. Client ids are unique: re-evaluating
this file without the `dispose` above throws `CLIENT_ID_TAKEN`; pass
`{ onConflict: 'reset' }` if you would rather reuse the id and drop the
old subscriptions. In React or Vue, `bindHooks(cartClient)` /
`bindComposables(cartClient)` turn this client into hooks that need no
client argument — see [`@hedwigjs/react`](../react) and
[`@hedwigjs/vue`](../vue).

### Point-to-point request with a typed response

```ts
const result = await checkoutClient.request<'cart.get-total.v1', number>(
  'cart',
  'cart.get-total.v1',
  undefined,
);

if (result.status === 'ACK') {
  proceed(result.data); // typed as number
}
```

With `TopicContracts` as the client's third type parameter the explicit
`<'cart.get-total.v1', number>` is unnecessary — the answer type comes
from the contract's `response`.

The recipient's handler simply returns a value:

```ts
cartClient.on('cart.get-total.v1', () => computeTotal());
```

### Late-joining subscriber gets last state

```ts
// Producer — `cart.snapshot.v1` is a `state` topic; the runtime keeps the last value.
void cartClient.emit('cart.snapshot.v1', snapshot);

// Late subscriber: the last value arrives synchronously inside on(), flagged `replayed`.
menuClient.on('cart.snapshot.v1', render);

// An event with `retention: { last: N }` is replayed on request:
panel.on('notification.show.v1', showToast, { replay: { limit: 10 } });
```

### Cross-tab sync

```ts
import { createRemoteClient } from '@hedwigjs/broker';

createRemoteClient('tabs', {
  transport: { kind: 'broadcast-channel', name: 'my-app' },
  identity: { mode: 'prefix', prefix: 'tab' },
  forward: ['theme.*', 'user.session.*'],
  accepts: ['theme.*', 'user.session.*'],
});
```

Now any `emit` on those topics reaches every open tab of the same
origin. On the receiving side the same handler runs, with
`msg.fromExternal === true`, `msg.via === 'tabs'` and the sender's id
prefixed (`tab:settings`) so it cannot be confused with a local client.

### Declarative allowlist ACL

```ts
const ALLOW: Record<string, string[]> = {
  shell: ['*'],
  cart: ['cart.*'],
  menu: ['menu.*', 'cart.get-total.v1'],
};

getBroker().useBeforeSendHook((msg) => {
  const patterns = ALLOW[msg.source] ?? [];
  const ok = patterns.some((p) => matchPattern(msg.topic, p));
  return ok
    ? { allowed: true }
    : { allowed: false, message: `${msg.source} may not emit ${msg.topic}` };
});
```

Every rejection surfaces as `message.rejected` on `$systemEvents` —
route it to your audit sink for a security signal.

### Pluggable logger

```ts
initBroker({
  logger: {
    warn: (event, meta) => log.warn({ event, ...meta }),
    error: (event, meta) => Sentry.captureMessage(event, { extra: meta }),
  },
});
```

`BrokerLogEvent` is a closed union of stable string codes
(`'handler.failed'`, `'hook.failed'`, `'remote.send.failed'`,
`'broker.duplicate_copy'`, `'debug.disabled'`, …) — safe to use as
filter keys in Sentry / Datadog / Grafana.

The logger is isolated from the pipeline: if your `warn` / `error`
implementation throws (sink offline, serializer choked on `meta`), the
broker reports it once to `console.error` as `logger.failed` and
carries on. A broken observability sink never turns into a broken
message bus.

---

## Performance

`@hedwigjs/broker` ships a 15-scenario tinybench harness. Highlights
from the reference machine (macOS, M-series):

- `emit` throughput at 10 subscribers — millions of ops/sec.
- Dispatch cost stays constant per-subscriber as fan-out grows to
  10 000 (`04-fanout-scaling`).
- Dispatch stays O(1) across 10 000 unrelated topics
  (`08-multi-topic-isolation`).
- Backpressure wrapper adds tens of nanoseconds per call
  (`07-backpressure-overhead`).

```bash
npm run bench             # every scenario, sequentially
npm run bench:one 04      # one scenario, matched by prefix
```

Full method and scenario list: [`benchmarks/README.md`](./benchmarks/README.md).

---

## TypeScript — bring your own contracts

A client takes three type parameters — `Topic` (the string union),
`TopicPayloads` (the `topic → payload` map) and, optionally,
`TopicContracts` (the `topic → { kind, response? }` map that makes the
verbs kind-aware and types request answers). The runtime takes the
matching value, `TOPIC_KINDS`. All of them can come from anywhere; the
runtime does not care.

```ts
// Hand-written
type Topic = 'user.login.v1' | 'cart.get-total.v1';
type TopicPayloads = {
  'user.login.v1': { userId: string };
  'cart.get-total.v1': void;
};
type TopicContracts = {
  'user.login.v1': { kind: 'event' };
  'cart.get-total.v1': { kind: 'request'; response: number };
};
const TOPIC_KINDS = { 'user.login.v1': 'event', 'cart.get-total.v1': 'request' } as const;

// Or generated from Zod schemas, Protobuf, GraphQL codegen, OpenAPI,
// or the opinionated starter kit `@hedwigjs/create-registry`.
```

Without `TopicContracts` every topic is open to both verbs and
`request()` needs its answer type passed explicitly — untyped code
keeps compiling.

The `@hedwigjs/create-registry` CLI scaffolds a topic registry package
for TS-first greenfield projects, but nothing forces it — mix
generated and hand-written topics in one map if that suits your
codebase. See
[`../../docs/content/guides/bring-your-own-contracts.md`](../../docs/content/guides/bring-your-own-contracts.md).

---

## License

MIT.
