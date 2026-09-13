<div align="center">

[![CI](https://github.com/hedwigjs/hedwig/actions/workflows/ci.yml/badge.svg)](https://github.com/hedwigjs/hedwig/actions/workflows/ci.yml)


<img src="./docs/assets/hedwig-owl.png" alt="Hedwig — a friendly owl carrying an envelope" width="180" />

<h1>Hedwig</h1>

<p><strong>Contract-first messaging for the modules that make up a web application.</strong></p>

<p>One typed API across every transport. First-class observability out of the box. Extensible through hooks — without touching core.</p>

</div>

---

## What is Hedwig

Hedwig is a messaging broker for web applications — and everything they
talk to. It unifies transport-level plumbing (`postMessage`,
`MessagePort`, `BroadcastChannel`, `WebSocket`, `SSE`, or your own)
behind a single typed API, ships first-class observability out of the
box, and lets you extend behaviour through hooks without patching core.

A **module** is any participant that forms the communication graph
inside your web application — a microfrontend, an iframe, a browser
tab, a Web/Service Worker, a backend service the app is connected to.
Hedwig doesn't care where the module runs, only what topics it speaks.

A **message** is one typed unit that travels through the broker: a
topic + payload + routing metadata. Every topic is declared in a
contract with one of three kinds:

- **event** — something happened; fire-and-forget broadcast to whoever's subscribed
- **request** — a targeted call to a specific module: either a **command** ("do this") or a **query** ("give me this"). Either way, a typed response — success or failure — comes back to the sender
- **state** — a current value. The runtime keeps the last one and hands it to every new subscriber, so a late-joining module never has to ask for it

The kind lives in the contract, not at the call site: the SDK's types
decide which verb a topic accepts, the runtime decides what to retain.

## The problem it solves

In a modern web product a single user action fans out across
microfrontends, iframes, workers, tabs, WebSocket-connected backends,
SSE streams. Each seam gets its own vocabulary: `postMessage` here,
`socket.emit` there, `EventTarget` for one thing, `BroadcastChannel` for
another. Payloads are untyped, error paths are ad-hoc — and once the
traffic starts flowing, the messaging layer between everything stays
invisible to the tools you already use.

## What Hedwig gives you

### 🔌 One typed API for every transport

`client.on`, `client.emit`, `client.request` — the same three methods
regardless of what's on the other side. Modules living in the same
runtime talk to each other **in-process** through the broker's
routing — no transport involved. When a module lives elsewhere
(another tab, an iframe, a Worker, a backend service), it joins as a
**remote client** behind a transport; the caller writes exactly the
same code.

```ts
import { createClient } from '@hedwigjs/client';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

const cartClient = createClient<Topic, TopicPayloads, TopicContracts>('cart-mfe');

// Subscribe. For a state topic the retained value arrives inside `on()`
cartClient.on('cart.snapshot.v1', (msg) => renderCart(msg.data));

// Fire an event to everyone subscribed
cartClient.emit('user.clicked-checkout.v1', { productId: 42 });

// Send a targeted request; the typed answer is on `.data`
const result = await cartClient.request('checkout-mfe', 'checkout.submit.v1', cartSnapshot);
if (result.status === 'ACK') showOrder(result.data.orderId);
```

Built-in transports are named by descriptor (`{ kind: 'websocket' }`,
`postmessage`, `message-port`, `sse`, `broadcast-channel`); custom ones
implement the `Transport` interface (`send`, `onMessage`, `destroy`, plus
optional capability flags) — WebRTC, Service Worker messaging, Electron
IPC — and pass the checks in `@hedwigjs/broker/conformance`.

### ✉️ Every message declared with its intent

Not every message is the same. Treating a "user clicked" event and a
"please submit this order" command as identical strings on the wire is
how systems drift into subtle bugs — lost responses, unwanted retries,
untracked failures. Hedwig gives each intent distinct machinery instead
of one indiscriminate bag of "messages":

| Kind        | API                                            | What it means                                                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Event**   | `client.emit(topic, data)`                     | Fire-and-forget broadcast. Everyone subscribed receives it; sender doesn't wait. Perfect for UI facts (`user.clicked-checkout.v1`). May declare `retention: { last: N }` in its contract for subscribers that arrive later.                                              |
| **Request** | `await client.request(target, topic, input)`   | Targeted call to a specific module — either a **command** ("do this") or a **query** ("give me this"). Resolves a `RoutingResult`: the typed answer in `.data`, or a typed failure (`HOOK_REJECTED`, `HANDLER_FAILED`, `NOT_SUBSCRIBED`, `TIMEOUT`). Command example: `cart.add-item.v1` — «add product, tell me the new quantity». Query example: `notification.status.v1` — «how many clients are connected?». |
| **State**   | `client.emit(topic, value)` / `client.on(topic, fn)` | A current value (`cart.snapshot.v1`). The runtime keeps the last one and delivers it to every new subscriber synchronously inside `on()`, flagged `replayed: true`. Pass `{ retained: false }` to `on()` for live updates only.                                        |

The contract carries the kind (plus `response` for a request);
`createClient<Topic, TopicPayloads, TopicContracts>` turns it into
compile-time checks — `emit` on a request topic is a type error — and
DevTools tags every message row with it.

**Retention** follows the contract too: a `state` topic keeps its last
value, an event that declares `retention: { last: N }` keeps its last N
for subscribers that ask — `client.on(topic, fn, { replay: { limit: 10 } })`.
Nothing is flagged at the emit site; the host only passes the registry,
`initBroker({ topics: TOPIC_KINDS })`, and can cap retention with
`history: { maxPerTopic, ttl }`.

### 🔭 End-to-end observability

Every message — regardless of transport, regardless of whether the
sender was a browser tab or a backend service — flows through one
broker pipeline and shows up in one DevTools panel: messages, clients
(local and remote), replay buffer, system events. Security signals
(hook-rejected subscriptions, blocked sends) get their own dedicated
stream so audit tooling can consume them without inspecting every user
message.

Attach cost is negligible — the benchmark suite measures a
DevTools-shape observer at under 1% overhead per emit.

### 🎛 Full control over the message lifecycle

Hedwig lifts the broker pipeline out of the black box and gives you
three named extension points:

| Hook                  | Fires…                          | Can block? | Typical use                                                     |
| --------------------- | ------------------------------- | :--------: | --------------------------------------------------------------- |
| `useBeforeSendHook`   | Before every outgoing message   | ✅         | ACL, request signing, feature-flag gating, tracing enrichment   |
| `useAfterSendHook`    | After every delivery attempt    | —          | Audit trail, metrics, distributed-tracing spans, DevTools feed  |
| `useOnSubscribeHook`  | When a client calls `on`        | ✅         | Deny-by-default policies, tenant isolation, DevTools gating     |

Blocking a send yields a typed `HOOK_REJECTED` result to the caller.
Blocking a subscribe throws from `client.on` and surfaces on the
`subscription.rejected` system-events channel — so audit tools see it
without inspecting user messages. A guard hook that throws fails
closed by default.

```ts
import { getBroker } from '@hedwigjs/broker';

const broker = getBroker();

// Block: an untrusted module cannot trigger business flows
broker.useBeforeSendHook((msg) => {
  if (msg.source === 'analytics' && msg.topic.startsWith('checkout.')) {
    return { allowed: false, message: 'analytics may not trigger checkout' };
  }
  return { allowed: true };
});

// Observe: emit an OpenTelemetry span on every delivery
broker.useAfterSendHook((msg, result) => {
  tracer.recordEvent(msg.topic, {
    source: msg.source,
    status: result.status,
    reason: result.reason,
  });
});
```

Hooks stack — auth + audit + metrics + custom validators sit alongside
each other without any of them knowing about the others.

## What ships

| Package                     | What it is                                                                                                                                                                                                                                                                                        | Status                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `@hedwigjs/client`          | SDK for modules: `createClient` / `createRemoteClient`, `whenRuntimeReady`, `hasCapability`, `getRuntimeInfo`, and every type a module can see. No runtime dependency — finds the host's runtime through a per-realm handle (`Symbol.for('@hedwigjs/runtime/1')`) and works before `initBroker()` (lazy client, flushed in order). | Unreleased |
| `@hedwigjs/react`           | Hooks on top of the SDK: `useClient`, `useTopic`, `useStateTopic` (retained value, before first paint when the runtime is already there), `useRequest` (`send` + `pending` / `result`), `useRemoteClient` (a remote for the component's lifetime), `useRuntimeReady`, `bindHooks`. React 18 / 19. | Unreleased |
| `@hedwigjs/vue`             | The same as Vue 3 composables, plus `bindComposables`. | Unreleased |
| `@hedwigjs/broker`          | The runtime (host only): `initBroker`, `getBroker`, `createRemoteClient`. Routes messages **in-process** between clients on the same broker and, through **remote clients**, across contexts (iframes, tabs, workers, backends over `postmessage` / `message-port` / `broadcast-channel` / `websocket` / `sse` / your own). Hooks (`beforeSend` / `afterSend` / `onSubscribe`), per-topic retention, backpressure. Ships the wire envelope v1 JSON Schema (`@hedwigjs/broker/spec/envelope-v1.schema.json`) and the transport conformance kit (`@hedwigjs/broker/conformance`). | Published (0.1.1) |
| `@hedwigjs/devtools`        | React panel (React 18.2 / 19) that mounts inside the host app. Messages, clients (local and remote), replay buffer, dedicated system-events stream.                                                                                                                                                | Published (0.1.1) |
| `@hedwigjs/create-registry` | Optional CLI (`npm create @hedwigjs/registry`) that scaffolds a topic-registry package: one contract file per topic (`kind`, payload, `response`, `retention`) and codegen for `Topic`, `TopicPayloads`, `TopicContracts`, `TOPIC_KINDS`. The broker also accepts topic types from Zod / Protobuf / GraphQL / hand-written — registry is a pattern, not a mandate. | Published (0.1.1) |

## Quickstart

```ts
// 1. Boot the runtime once, from the host / shell
import { initBroker } from '@hedwigjs/broker';
import { TOPIC_KINDS } from '@my-org/topics';
import type { Topic, TopicPayloads } from '@my-org/topics';

initBroker<Topic, TopicPayloads>({ topics: TOPIC_KINDS });

// 2. Every module creates its own client — from the SDK, not the runtime
import { createClient } from '@hedwigjs/client';
import type { TopicContracts } from '@my-org/topics';

const cartClient = createClient<Topic, TopicPayloads, TopicContracts>('cart-mfe');

cartClient.on('cart.snapshot.v1', (msg) => renderCart(msg.data));
cartClient.emit('user.viewed-menu.v1', { at: Date.now() });

// 3. Mount DevTools during development
import { MessageBrokerDevTools } from '@hedwigjs/devtools';
import { getBroker } from '@hedwigjs/broker';

createRoot(devHost).render(
  <MessageBrokerDevTools
    broker={getBroker()}
    enabled={process.env.NODE_ENV === 'development'}
  />,
);
```

Boot order does not matter: a module that calls `createClient` before
`initBroker()` gets a lazy client that flushes in order once the runtime
appears. Modules never import `@hedwigjs/broker` — the SDK finds the
runtime through a per-realm handle, so Module Federation does not have
to share it. `@hedwigjs/react` / `@hedwigjs/vue` bind the same calls to
the component lifecycle. For cross-tab or iframe traffic, register a
remote client (`createRemoteClient(id, { transport: { kind: 'broadcast-channel', name } })`)
— same three methods on the sender side, no code change to the receiver.

## Reference stand

> **Live demo → [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)**

`examples/advanced/` hosts **Hedwig Café** — a food-delivery demo that
puts every value prop above in one screen: unified API across modules,
all three topic kinds in the same log, remote clients over four
transports, DevTools showing everything at runtime, and an ACL layer
implemented through hooks.

### Modules in play

**Frontend (in the browser):**

| Module          | Client id(s)                              | Role                                                                                                                          |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `shell`         | —                                         | Single-spa host. Boots the runtime with `TOPIC_KINDS`, installs ACL hooks, registers the WebSocket and cross-tab remotes, mounts DevTools |
| `menu`          | `menu`                                    | Dish grid. Sends `cart.add-item.v1` requests to the cart store                                                                |
| `cart`          | `cart-store`, `cart-ui`                   | Cart store + UI. Owns the cart, publishes the `cart.snapshot.v1` state                                                        |
| `late-mount`    | `late-mount-demo`                         | Demo card from the cart package: mounts a fresh client on demand and gets the retained snapshot inside `on()`                |
| `remote-request` | `remote-request-demo`                    | Demo card from the cart package: asks the backend `notification.status.v1` over the WebSocket and shows the answer            |
| `checkout`      | `checkout`                                | Headless iframe controller. Handles the `checkout.start.v1` request, registers the iframe as a remote client                  |
| `notifications` | `notifications-toast`                     | Toast panel. Subscribes to `notification.show.v1`                                                                             |
| `ai-chat`       | `ai-chat`                                 | Streaming chat. Registers one SSE remote per reply                                                                            |
| `analytics`     | `analytics`                               | Semi-trusted read-only tracker — demonstrates ACL rejections                                                                  |

**Remote clients (behind a transport):**

| Remote client id        | Transport           | Registered by                                                                   | Role                                                                                        |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `notifications-backend` | `websocket`         | shell, [`shell/src/remotes.ts`](./examples/advanced/shell/src/remotes.ts)       | Pushes `notification.show.v1` to every subscriber; answers `notification.status.v1` requests |
| `tabs`                  | `broadcast-channel` | shell, same file                                                                | Other browser tabs. Forwards our `cart.snapshot.v1`, accepts theirs — attributed as `tab:cart-store` (prefix identity) |
| `ai-backend`            | `sse`               | ai-chat MFE, one remote per reply                                               | Streams `chat.reply-chunk.v1` + `chat.reply-completed.v1`                                   |
| `checkout-iframe`       | `postmessage`       | checkout MFE, via `useRemoteClient`                                             | Iframe HTML served at `/checkout`; sends `checkout.completed.v1` on submit                  |

Remote clients speak the same topics as any local module and pass the
same hooks and ACL ([`shell/src/security/acl.ts`](./examples/advanced/shell/src/security/acl.ts),
deny by default). In DevTools they carry a `remote` badge in Clients and
a `via <id>` pill on every message row. The backend has no Hedwig
dependency: it emits wire envelope v1 frames, validated in its tests
against the shipped JSON Schema.

### Running locally

```bash
npm install
npm run dev:demo        # every service in parallel
npm run stop:demo       # frees ports 3000-3006, 4000
npm run restart:demo    # stop + dev
npm run e2e             # Playwright suite against the stand (boots it itself)
```

Local ports:

| Service        | URL                     |
| -------------- | ----------------------- |
| shell          | http://localhost:3000   |
| menu           | http://localhost:3001   |
| cart           | http://localhost:3002   |
| ai-chat        | http://localhost:3003   |
| notifications  | http://localhost:3004   |
| checkout       | http://localhost:3005   |
| analytics      | http://localhost:3006   |
| backend        | http://localhost:4000   |

### 60-second walkthrough

Works on either the [live demo](https://hedwigjs.com/demo/advanced) or
your local http://localhost:3000.

1. Click the mascot button on the right edge → the DevTools panel opens.
2. Add a dish. In the *Messages* tab you see three messages in one
   flow: `cart.add-item.v1` (**request** — unicast, answered by
   `cart-store`), `cart.snapshot.v1` (**state** — its last value is
   retained for whoever subscribes next), `notification.show.v1`
   (**event** with `retention: { last: 10 }` — multicast, from a backend
   remote client over WebSocket).
3. Under the cart, press **Mount**: a fresh client subscribes to
   `cart.snapshot.v1` and shows the current cart at once — nobody
   re-emitted anything. **Ask the backend** sends `notification.status.v1`
   over the WebSocket to `notifications-backend`; the answer lands in `.data`.
4. Click **Check out** → `checkout.start.v1` request from cart to the
   checkout MFE; the iframe joins as a remote client over `postMessage`
   and its `checkout.completed.v1` clears the cart.
5. In the analytics widget («ACL demo — try to break the rules»), press
   both buttons → the *System Events* tab shows `subscription.rejected` +
   `message.rejected` with the ACL message inline.
6. Add a dish in a second tab — the first tab's cart updates through the
   `tabs` remote, attributed to `tab:cart-store`.
7. Toggle **EN · RU** in the top-right header — everything relocalizes,
   including the backend-served AI replies and notification bodies
   (each client passes `?lang=` to the WS / SSE handshake).

### Deployment

The live demo runs behind a single-VM setup — nginx serves the static
shell + MFE bundles under `/demo/advanced/`, proxies WebSocket / SSE /
checkout iframe to a Node backend on the same host. Full nginx config
is version-controlled at
[`examples/advanced/deploy/nginx.conf`](./examples/advanced/deploy/nginx.conf).

Any push to `main` that touches `examples/advanced/**` or
`packages/{client,broker,devtools,react}/**` triggers
[`deploy-stand.yml`](./.github/workflows/deploy-stand.yml) —
rebuild → rsync → smoke test → done in ~1 minute.

## Development

Node 22 (`.nvmrc`), npm workspaces. From the repo root:

```bash
npm run build        # client → broker → devtools → react → vue
npm run typecheck    # every workspace: packages, contracts, backend, shell, MFEs
npm test             # unit suites: client, broker, devtools (+ a React 18 smoke), react, vue, demo backend
npm run e2e          # Playwright, 8 scenarios against the reference stand
```

[`ci.yml`](./.github/workflows/ci.yml) runs the same on every push and
pull request, checks that the registry codegen is committed, and
requires a changeset for any public package a PR touches.
[`release.yml`](./.github/workflows/release.yml) versions and publishes
through Changesets with npm provenance. Code owners, the PR template and
Dependabot live under `.github/`. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Benchmarks

The 15-file benchmark suite lives in
[`packages/broker/benchmarks/`](./packages/broker/benchmarks/) — full
methodology and per-scenario numbers are in its
[README](./packages/broker/benchmarks/README.md). Ballpark on an
M-series MacBook:

- **3.1M emit/sec** at 1 subscriber · **p99 500 ns**
- Fan-out scales cleanly — **~90 ns / subscriber** all the way to 10 000
- **~2 ns per additional beforeSend hook**
- **< 1 %** overhead for a DevTools-shape observer attached
- **~814 B per subscription** heap footprint
- **~14 ns** extra to round-trip through a remote client's transport

```bash
cd packages/broker
npm run bench           # every bench file
npm run bench:one 04    # single file, by prefix
```

## Repository layout

```
hedwig/
├── packages/
│   ├── client/         # @hedwigjs/client — SDK for modules
│   ├── broker/         # @hedwigjs/broker — runtime + hooks + remote clients + wire schema
│   ├── react/          # @hedwigjs/react — hooks on the SDK
│   ├── vue/            # @hedwigjs/vue — composables on the SDK
│   ├── devtools/       # @hedwigjs/devtools — React panel
│   └── create-registry/# @hedwigjs/create-registry — scaffolder
├── examples/
│   └── advanced/       # "Hedwig Café" reference stand + Playwright e2e
└── docs/content/
    ├── spec/           # wire envelope v1, delivery semantics, threat model, support matrix
    ├── rfcs/           # design records
    └── guides/
```

Design decisions live under [`docs/content/rfcs/`](./docs/content/rfcs);
the wire format, delivery semantics, threat model and support matrix
under [`docs/content/spec/`](./docs/content/spec).

## Status

Everything above ships today. The direction in
[RFC 0003](./docs/content/rfcs/0003-participants-runtime-sdk.md) — topic
kinds declared in contracts with compile-time enforcement, correlation-id
requests to and from remote clients, per-topic retention, the runtime/SDK
split and the wire envelope — is implemented. Standalone
`@hedwigjs/adapter-*` packages ([RFC 0001](./docs/content/rfcs/0001-transport-adapters.md))
are withdrawn: transports stay inside the runtime and modules name them
by descriptor. New design changes get an RFC before code.

## License

[MIT](./LICENSE)
