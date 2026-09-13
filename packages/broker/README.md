# @hedwigjs/broker

Runtime broker for the Hedwig messaging toolkit. One typed API for
event and request messages across modules — in-process, cross-frame,
cross-tab, and cross-process — with hooks and observability built in.

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
- [API reference](#api-reference)
  - [Broker facade](#broker-facade)
  - [Client](#client)
  - [Broker extension surface](#broker-extension-surface)
- [Message shape](#message-shape)
- [RoutingResult](#routingresult)
- [Remote clients](#remote-clients)
- [Custom transports](#custom-transports)
- [Wire format](#wire-format)
- [Hooks](#hooks)
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

Boot the broker once in the host, create a typed client per module,
subscribe and emit.

```ts
import { initBroker, createClient } from '@hedwigjs/broker';

type Topic = 'cart.item-added.v1' | 'cart.get-total.v1';
type TopicPayloads = {
  'cart.item-added.v1': { sku: string; qty: number };
  'cart.get-total.v1': void;
};

// 1. Host bootstrap — once, in the shell.
initBroker<Topic, TopicPayloads>({
  history: { enabled: true, maxSize: 200 },
});

// 2. Per-module client — typed.
const cartClient = createClient<Topic, TopicPayloads>('cart');

// 3. Fire-and-forget event.
cartClient.on('cart.item-added.v1', (msg) => {
  console.log('added', msg.data.sku, '×', msg.data.qty);
});
void cartClient.emit('cart.item-added.v1', { sku: 'CROISSANT', qty: 2 });

// 4. Typed request → response.
cartClient.on('cart.get-total.v1', () => 12.5); // handler returns
const analyticsClient = createClient<Topic, TopicPayloads>('analytics');
const result = await analyticsClient.request<'cart.get-total.v1', number>(
  'cart',
  'cart.get-total.v1',
  undefined,
);
// result.status === 'ACK', result.data === 12.5
```

Topic strings, payload shapes, and request responses are all inferred
from the two type parameters. Rename a topic in one place — TypeScript
lights up every subscriber and emitter that has drifted.

---

## Core concepts

- **Message** — one typed unit that travels through the broker: a
  `topic` + `data` payload + routing metadata (`source`, `target`,
  `id`, `timestamp`).
- **Topic** — a versioned string like `'cart.item-added.v1'`. Every
  topic maps to exactly one payload type in the `TopicPayloads` map.
- **Module (client)** — any participant in the communication graph.
  Each module obtains its own `Client` from `createClient(id)` and uses
  it for the full lifecycle of that module.
- **Broker** — the singleton runtime returned by `initBroker(config)`.
  Owns the routing plane, the hook chain, the history buffer, and the
  remote clients. In-process by default; remote clients extend it
  across contexts.
  One instance per realm, even if the library is bundled more than once
  on the page — see [One broker per realm](#one-broker-per-realm).
- **Remote client** — a participant whose code runs on the far side of a
  transport (postMessage, WebSocket, BroadcastChannel, …). Locally a
  proxy: its `forward` patterns are its subscriptions, `accepts` names
  what it may inject; inbound frames enter the same pipeline as
  `fromExternal: true` with `via` set to the remote's id.
- **Two semantics** — `emit()` for fan-out events, `request()` for a
  targeted call awaiting a typed response. Retention and replay are an
  orthogonal mechanism layered on top of both, not a third semantic.

The broker is **contract-first**: topics and payloads are described in
TypeScript, and the runtime is a thin executor over that contract.

---

## API reference

### Broker facade

```ts
import {
  initBroker,
  getBroker,
  createClient,
  destroyBroker,
} from '@hedwigjs/broker';
```

| Function                                | Purpose                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `initBroker<T, P>(config?)`             | Boot the broker once. Idempotent — returns the existing instance if already initialized.      |
| `getBroker<T, P>()`                     | Return the current broker without holding the `initBroker` reference. Throws if not booted.   |
| `createClient<T, P>(id)`                | Return the typed `Client` for `id`. Idempotent: existing clients are reset and returned.      |
| `destroyBroker()`                       | Tear down remote clients, subscriptions, history, hooks, and the client registry.             |

`BrokerConfig`:

```ts
{
  history?: {
    enabled: boolean;
    maxSize?: number; // default 1000
    ttl?: number;     // ms, undefined = no expiration
  };
  logger?: BrokerLogger; // see "Logger" below
  debug?: boolean;       // arms broker.$debug.send — default false
  topics?: TopicKindMap; // TOPIC_KINDS from the registry: `state` topics are retained
}
```

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

- Module Federation remotes bundled without `singleton: true`;
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
Pin the version in Module Federation so a mismatch fails at load time,
not at runtime:

```js
shared: {
  '@hedwigjs/broker': { singleton: true, strictVersion: true, requiredVersion: '^0.2.0' },
}
```

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

Returned by `createClient(id)`.

| Method                                              | Semantics                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `on(topic, handler, options?)`                      | Subscribe. Returns an unsubscribe function. Accepts `backpressure`, `replay` and `noLocal` (default `true`: your own emits are not delivered to you) options. Throws if an `onSubscribe` hook rejects. |
| `off(topic)`                                        | Unsubscribe. No-op if not subscribed.                                                                                     |
| `emit(topic, data, options?)`                       | Broadcast to every subscriber of `topic`. Resolves with the aggregated `RoutingResult`.                                    |
| `request<K, R>(recipient, topic, data, options?)`   | Targeted call to one recipient. Resolves with `RoutingResult<R>` where `R` is the handler's return type. Answered by the recipient's first handler, bypassing its backpressure. `options.timeout` (ms) bounds the wait: `NACK TIMEOUT` on expiry, the handler keeps running. |
| `reset()`                                           | Drop every subscription for this client; keep it registered. Used internally for HMR / re-mount.                          |
| `destroy()`                                         | Unregister the client; the instance becomes inert.                                                                        |
| `id`                                                | The client id passed to `createClient`.                                                                                   |

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
| `capabilities`                                    | readonly      | `Set` of stable strings this runtime supports (`transport.websocket`, …).                        |
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
  replayed?: boolean;      // true when delivered from the history buffer
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

| Reason              | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `DELIVERED`         | Unicast delivered; handler ran to completion.                  |
| `DISPATCHED`        | Multicast dispatched to at least one subscriber.               |
| `REPLAY_DELIVERED`  | Message came from the history buffer (replay).                 |
| `HOOK_REJECTED`     | A `beforeSend` hook returned `{ allowed: false }`.             |
| `NO_SUBSCRIBERS`    | Multicast — no one is subscribed to this topic.                |
| `NOT_SUBSCRIBED`    | Unicast — target exists but has no handler for this topic.     |
| `HANDLER_FAILED`    | The handler threw; the error is logged and the promise resolves NACK. |
| `BROKER_DESTROYED`  | Emit called on a destroyed broker.                             |
| `DEBUG_DISABLED`    | `$debug.send` called on a broker booted without `debug: true`. |
| `TIMEOUT`           | Unicast — the handler did not settle within `options.timeout`. It is not cancelled. |

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
import { createRemoteClient } from '@hedwigjs/broker';

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
- The runtime exports `parseFrame` / `buildFrame` and `WIRE_VERSION` for
  custom transports and tests; ingress uses the same check.

---

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

---

### When a hook throws

Guard hooks (`beforeSend`, `onSubscribe`) **fail closed** by default: a
hook that throws counts as a denial, so a crashing ACL never lets
traffic through. The message resolves `NACK HOOK_REJECTED` (subscribe
throws), and a `hook.failed` system event plus a `hook.failed` log line
say it was a crash, not a policy decision. Opt into the old behaviour
with `initBroker({ hooks: { failMode: 'open' } })` — the throwing hook
is then skipped. `afterSend` hooks are observers and are always
isolated.

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
and treats **state** topics specially: the last local multicast on each
is retained and delivered to every new subscriber synchronously inside
`on()`, flagged `replayed: true` (MQTT's retained message). No
`history: true` at the emit site, no `replay` option at the subscriber;
pass `{ retained: false }` to `on()` for live updates only. Retained
values are independent of the history buffer, listed by
`inspect.getRetained()`, and announced as `state.retained` on
`$systemEvents`. Requests are never recorded to history —
`RequestOptions` is `{ timeout }`.

---

## Message history & replay

The broker keeps an in-memory ring buffer. Enable it once in
`initBroker`, opt in per-message on `emit`, and opt in per-subscription
on `on`.

```ts
initBroker({
  history: { enabled: true, maxSize: 500, ttl: 60_000 }, // 1 min TTL
});

// Producer opts a message in.
void cartClient.emit(
  'cart.snapshot.v1',
  { items, total },
  { history: true },
);

// Late subscriber replays the most recent 10 snapshots.
menuClient.on(
  'cart.snapshot.v1',
  (msg) => renderCart(msg.data),
  { replay: { limit: 10 } },
);
```

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
every request immediately. (Before 0.2 a request to such a subscription
resolved `ACK` with no data even when the strategy dropped it.)

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

| Event                    | Payload                                                    | Fired when                                                                 |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `broker.duplicate_copy`  | `{ version, copyVersion, copies, at }`                     | Another compatible copy of the library adopted this instance through the realm slot. Still one bus. |
| `client.registered`      | `{ clientId, at }`                                         | `createClient(id)` registers a new id.                                      |
| `client.unregistered`    | `{ clientId, at }`                                         | `client.destroy()` or broker teardown.                                      |
| `subscription.added`     | `{ clientId, topic, options? }`                            | `client.on(topic, …)` succeeds.                                             |
| `subscription.removed`   | `{ clientId, topic }`                                      | `client.off(topic)` or reset/destroy.                                       |
| `subscription.rejected`  | `{ clientId, topic, reason }`                              | An `onSubscribe` hook denied the subscription. Client also throws.          |
| `message.rejected`       | `{ source, target, topic, reason }`                        | A `beforeSend` hook denied a message. Emit also resolves `NACK HOOK_REJECTED`. |
| `hook.failed`            | `{ kind, failMode, error, topic?, messageId?, source?, clientId? }` | A hook threw. Guard hooks deny under `failMode: 'closed'` (default) and are skipped under `'open'`; `afterSend` is always skipped. |
| `remote.created`         | `{ remoteId, kind, identity, at }`                         | `createRemoteClient(id, …)`. `client.registered` fires too.                 |
| `remote.destroyed`       | `{ remoteId, at }`                                         | `remote.destroy()`, transport closed, or broker teardown. `client.unregistered` fires too. |
| `remote.frame.rejected`  | `{ remoteId, reason, source?, topic? }`                    | An inbound frame was dropped at the edge before any hook: `MALFORMED`, `TOO_LARGE`, `RATE_LIMITED`, `UNSUPPORTED` (bad `v` / `kind`), `ECHO` (our own origin), `TOPIC_NOT_ACCEPTED`, `SOURCE_MISMATCH`, `SOURCE_NOT_ALLOWED`. |
| `remote.send.failed`     | `{ remoteId, topic, messageId, reason, error? }`           | A frame could not be sent: the transport threw (`TRANSPORT_THREW`) or never became ready (`NOT_OPEN`). The message was delivered locally and the caller got a normal result. |

```ts
const off = getBroker().$systemEvents.on('message.rejected', (evt) => {
  console.warn('blocked by ACL:', evt);
});

// Or subscribe to everything for a unified feed (DevTools style):
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

inspect.getClients();            // [{ id, connectedAt, subscriptions: [...], remote?: { kind, identity, ... } }, ...]
inspect.getSubscribedClientIds(); // ['cart', 'menu', ...]
inspect.getHistory();            // [{ message, timestamp, sequence }, ...]
inspect.getHistoryStats();       // { enabled, count, oldestTimestamp?, newestTimestamp?, memoryUsage? }
```

All array returns are `ReadonlyArray` — mutating them will not affect
broker state. This is the API `@hedwigjs/devtools` reads on the pull
path.

---

## Recipes

### Idiomatic module setup

```ts
// modules/cart/src/client.ts
import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@your-app/registry';

export const cartClient = createClient<Topic, TopicPayloads>('cart');
```

One client per module. Import it wherever the module needs to talk to
others. `createClient` is idempotent, so HMR and re-mounts are safe.

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

The recipient's handler simply returns a value:

```ts
cartClient.on('cart.get-total.v1', () => computeTotal());
```

### Late-joining subscriber gets last state

```ts
// Producer:
void cartClient.emit('cart.snapshot.v1', snapshot, { history: true });

// Late subscriber gets the most recent snapshot immediately:
cartClient.on(
  'cart.snapshot.v1',
  render,
  { replay: { limit: 1 } },
);
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

The broker consumes two type parameters — `Topic` (the string union)
and `TopicPayloads` (the `topic → payload` map) — from anywhere. The
runtime does not care where they come from.

```ts
// Hand-written
type Topic = 'user.login.v1' | 'cart.item-added.v1';
type TopicPayloads = {
  'user.login.v1': { userId: string };
  'cart.item-added.v1': { sku: string; qty: number };
};

// Or generated from Zod schemas, Protobuf, GraphQL codegen, OpenAPI,
// or the opinionated starter kit `@hedwigjs/create-registry`.
```

The `@hedwigjs/create-registry` CLI scaffolds a topic registry package
for TS-first greenfield projects, but nothing forces it — mix
generated and hand-written topics in one map if that suits your
codebase. See
[`../../docs/content/guides/bring-your-own-contracts.md`](../../docs/content/guides/bring-your-own-contracts.md).

---

## License

MIT.
