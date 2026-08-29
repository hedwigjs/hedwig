<div align="center">

<img src="./docs/assets/hedwig-owl.png" alt="Hedwig — a friendly owl carrying an envelope" width="180" />

<h1>Hedwig</h1>

<p><strong>Contract-first messaging for the modules that make up a web application.</strong></p>

<p>One typed API across every transport. First-class observability out of the box. Extensible through hooks — without touching core.</p>

</div>

---

## What is Hedwig

Hedwig is a messaging broker for web applications — and everything they
talk to. It unifies transport-level plumbing (`postMessage`,
`BroadcastChannel`, `WebSocket`, `SSE`, or your own) behind a single
typed API, ships first-class observability out of the box, and lets you
extend behaviour through hooks without patching core.

A **module** is any participant that forms the communication graph
inside your web application — a microfrontend, an iframe, a browser
tab, a Web/Service Worker, a backend service the app is connected to.
Hedwig doesn't care where the module runs, only what topics it speaks.

A **message** is one typed unit that travels through the broker: a
topic + payload + routing metadata. Messages live in the broker's
routing plane and carry one of two semantics:

- **event** — something happened; fire-and-forget broadcast to whoever's subscribed
- **request** — a targeted call to a specific module: either a **command** ("do this") or a **query** ("give me this"). Either way, a typed response — success or failure — comes back to the sender

Late-joining subscribers can catch up on retained state through the
broker's history + replay mechanism (see below) — no need to invent a
third semantic just for the "current state" case.

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
(another tab, an iframe, a Worker, a backend service), a **bridge**
wraps the wire; the caller writes exactly the same code.

```ts
import { createClient } from '@hedwigjs/broker';

const cartClient = createClient<Topics>('cart-mfe');

// Subscribe to updates from any module
cartClient.on('cart.snapshot.v1', (msg) => renderCart(msg.data));

// Fire an event to everyone subscribed
cartClient.emit('user.clicked-checkout.v1', { productId: 42 });

// Send a targeted request and await a typed response
const { orderId } = await cartClient.request<'checkout.submit.v1', OrderResp>(
  'checkout-mfe',
  'checkout.submit.v1',
  cartSnapshot,
);
```

Custom transports plug into the 3-method `BridgeTransport` interface
without touching core — WebRTC data channels, Service Worker
messaging, Electron IPC, whatever you need.

### ✉️ Every message declared with its intent

Not every message is the same. Treating a "user clicked" event and a
"please submit this order" command as identical strings on the wire is
how systems drift into subtle bugs — lost responses, unwanted retries,
untracked failures. Hedwig gives each intent distinct machinery instead
of one indiscriminate bag of "messages":

| Kind        | API                                            | What it means                                                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Event**   | `client.emit(topic, data)`                     | Fire-and-forget broadcast. Everyone subscribed receives it; sender doesn't wait. Perfect for UI facts (`user.clicked-checkout.v1`).                                                                                                                                        |
| **Request** | `await client.request(target, topic, input)`   | Targeted call to a specific module — either a **command** ("do this") or a **query** ("give me this"). Awaits a typed response captured in `RoutingResult.data`; failure paths are typed too (`HOOK_REJECTED`, `HANDLER_FAILED`, `NOT_SUBSCRIBED`). Command example: `cart.add-item.v1` — «add product, tell me the new quantity». Query example: `cart.get-total.v1` — «what's the current total?». |

In the DevTools log the two kinds are colour-coded and filterable
independently.

**Retention & replay** is an orthogonal mechanism, not a third
semantic. Any event flagged with `{ history: true }` is recorded to the
broker's ring buffer; any subscription with `{ replay: { limit: N } }`
receives the matching historical entries on subscribe. Combined, they
let modules like `cart-runtime` publish an event stream and give
late-joining subscribers the current snapshot without a separate query
round-trip. It's a pattern, not an API tier.

### 🔭 End-to-end observability

Every message — regardless of transport, regardless of whether the
sender was a browser tab or a backend service — flows through one
broker pipeline and shows up in one DevTools panel: messages, clients,
active bridges, replay buffer, system events. Security signals
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
without inspecting user messages.

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
| `@hedwigjs/broker`          | Runtime broker. Typed `emit` / `request` / `on`. Routes messages **in-process** between clients on the same broker, and — through **built-in or custom bridges** — across contexts (iframes, tabs, workers, backends via `postMessage` / `BroadcastChannel` / `WebSocket` / `SSE` / your own). Hook system (`beforeSend` / `afterSend` / `onSubscribe`), message history + replay, backpressure primitives. | Published |
| `@hedwigjs/devtools`        | React panel that mounts inside the host app. Messages, clients, bridges, replay buffer, dedicated system-events stream.                                                                                                                                                                            | Published |
| `@hedwigjs/create-registry` | Optional CLI (`npm create @hedwigjs/registry`) that scaffolds a topic-registry package with contract files + codegen. Broker also accepts topic types from Zod / Protobuf / GraphQL / hand-written — registry is a pattern, not a mandate.                                                          | Published |

## Quickstart

```ts
// 1. Boot the broker once, from the host / shell
import { initBroker } from '@hedwigjs/broker';
import type { Topics, TopicPayloads } from '@my-org/topics';

initBroker<Topics, TopicPayloads>({
  history: { enabled: true, maxSize: 1000 },
});

// 2. Every module creates its own client
import { createClient } from '@hedwigjs/broker';

const cartClient = createClient<Topics, TopicPayloads>('cart-mfe');

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

That's the full onboarding for a single-page app. For cross-tab or
iframe traffic, add a bridge with a `postMessage` or `BroadcastChannel`
transport — same three methods on the sender side, no code change to
the receiver.

## Reference stand

> **Live demo → [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)**
>
> Deployed on a Yandex Cloud VM behind Let's Encrypt HTTPS. Auto-updated
> from `main` via GitHub Actions ([`.github/workflows/deploy-stand.yml`](./.github/workflows/deploy-stand.yml)).
> Click the mascot on the right edge to open the DevTools panel.

`examples/advanced/` hosts **Hedwig Café** — a food-delivery demo that
puts every value prop above in one screen: unified API across modules,
both message intents (event and request) plus retained-history events
live in the same log, DevTools showing everything at runtime, and an
ACL layer implemented through hooks.

### Modules in play

**Frontend (in the browser):**

| Module          | Role                                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| `shell`         | Single-spa host. Installs ACL hooks, wires bridges, mounts DevTools               |
| `menu`          | Dish grid. Sends `cart.add-item.v1` requests to the cart runtime                  |
| `cart`          | Cart runtime + UI. Owns the cart state, publishes `cart.snapshot.v1`              |
| `checkout`      | Headless iframe controller. Handles `checkout.start.v1` request                    |
| `notifications` | Toast panel. Subscribes to `notification.show.v1`                                  |
| `ai-chat`       | Streaming chat over SSE                                                            |
| `analytics`     | Semi-trusted read-only tracker — demonstrates ACL rejections                       |

**Backend (over transports):**

| Module                  | Bridge      | Role                                                              |
| ----------------------- | ----------- | ----------------------------------------------------------------- |
| `notifications-backend` | WebSocket   | Pushes `notification.show.v1` to every connected frontend module   |
| `ai-backend`            | SSE         | Streams `chat.reply-chunk.v1` + `chat.reply-completed.v1`          |
| `checkout-iframe`       | PostMessage | Iframe HTML at `/checkout`; sends `checkout.completed.v1` on submit |

Backend modules speak the same topics as any frontend module — they
just cross a transport bridge to reach the broker. In DevTools they
appear with an `external` pill on the message row.

### Running locally

```bash
npm install
npm run dev:demo        # every service in parallel
npm run stop:demo       # frees ports 3000-3006, 4000
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

1. Click the mascot button on the right edge → DevTools docks at the
   bottom.
2. Add a dish. In the *Messages* tab you see three messages in one
   flow: `cart.add-item.v1` (**request** — unicast, awaits response
   from `cart-runtime`), `cart.snapshot.v1` (**event** with
   `{ history: true }` — retained so any late-joining module gets the
   current cart via `replay`), `notification.show.v1` (**event** —
   multicast, from a backend module through the WebSocket bridge).
3. Click «Оформить заказ» → `checkout.start.v1` request from cart to
   the checkout MFE, response captured in `RoutingResult.data`.
4. Under the cart, use the analytics widget's two «попробовать
   нарушить» buttons → open the *System Events* tab and watch
   `subscription.rejected` + `message.rejected` appear with the ACL
   message inline.
5. Toggle **EN · RU** in the top-right header — everything relocalizes,
   including the backend-served AI replies and notification bodies
   (each client passes `?lang=` to the WS / SSE handshake).

### Deployment

The live demo runs behind a single-VM setup — nginx serves the static
shell + MFE bundles under `/demo/advanced/`, proxies WebSocket / SSE /
checkout iframe to a Node backend on the same host. Full nginx config
is version-controlled at
[`examples/advanced/deploy/nginx.conf`](./examples/advanced/deploy/nginx.conf).

Any push to `main` that touches `examples/advanced/**`,
`packages/broker/**`, or `packages/devtools/**` triggers the deploy
workflow — rebuild → rsync → smoke test → done in ~1 minute.

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
- **~14 ns** extra to round-trip through a bridge

```bash
cd packages/broker
npm run bench           # every bench file
npm run bench:one 04    # single file, by prefix
```

## Repository layout

```
hedwig/
├── packages/
│   ├── broker/         # @hedwigjs/broker — runtime + hooks + bridges
│   ├── devtools/       # @hedwigjs/devtools — React panel
│   └── create-registry/# @hedwigjs/create-registry — scaffolder
├── examples/
│   └── advanced/       # "Hedwig Café" reference stand
└── docs/               # documentation + RFCs
```

Design decisions live under [`docs/content/rfcs/`](./docs/content/rfcs).

## Roadmap

The v2 direction — declared topic classes with compile-time
enforcement (event vs request vs retained state), correlation-id-based
cross-bridge requests, per-topic retention policy, and eventually
splitting transports into standalone `@hedwigjs/adapter-*` packages —
lives in [`docs/content/rfcs/`](./docs/content/rfcs) as design docs.
None of it is required to use the current runtime — everything above
ships today.

## License

[MIT](./LICENSE)
