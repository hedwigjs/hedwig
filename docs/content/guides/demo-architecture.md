# The `examples/advanced/` reference stand — architecture

> **Doc status (2026-08):** this page predates the CQRS-style cart
> refactor, the `analytics` and `late-mount` MFEs, and the switch from
> the in-tree `mock-bus` to the real `@hedwigjs/broker`. Names like
> `storefront` are now `menu`; the bus is a real published package.
> The current authoritative overview is
> [`examples/advanced/README.md`](../../../examples/advanced/README.md);
> the live deployment is at
> **[hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)**.
> The message-flow prose below still applies conceptually — the transport
> and hook mechanisms are unchanged.

Kitchen-sink demo showing the full breadth of what Hedwig supports —
reads code that already runs; no theory that isn't exercised somewhere
in the stand.

## What the stand demonstrates

| # | Capability | Exercised by |
| --- | --- | --- |
| 1 | Contract-based topics (`TopicMap`) | `shared/contracts/src/domains/*.ts` |
| 2 | Cross-realm singleton bus | `shared/mock-bus/src/index.ts` |
| 3 | Publish / subscribe with `{ replay: true }` | storefront ↔ cart |
| 4 | Cross-MFE bidirectional flow | storefront → cart → storefront |
| 5 | Multiple views of one state | cart panel + cart popup |
| 6 | Singleton runtime as SoT | `mfe/cart/src/state/cartStore.ts` |
| 7 | Read-only projection of shared state | `mfe/storefront/src/hooks/useLocalCartQuantities.ts` |
| 8 | Headless MFE (renders via portal) | `mfe/checkout/` |
| 9 | Cross-origin `postMessage` bridge | checkout iframe → parent |
| 10 | WebSocket → bus (ad-hoc adapter) | `mfe/notifications/src/hooks/useNotificationsSocket.ts` |
| 11 | SSE consumer | `mfe/ai-chat/src/ai/SseAiClient.ts` |
| 12 | Local UI state that stays out of the bus | `mfe/ai-chat/src/hooks/useChat.ts` |

## Layout at a glance

```
examples/advanced/
├── package.json                   # concurrently orchestrator (dev/stop/restart)
├── shell/                         # Module-Federation host + chrome + slots
│   └── src/
│       ├── styles/{reset.css, layout.css}   # global tokens + shell layout
│       ├── chrome/                # DOM skeleton, slot ensurance, AI drawer
│       └── registerMicrofrontends.ts
├── mfe/
│   ├── storefront/                # publisher of `cart.item.added/inc/dec/removed`, read-only view on cart.snapshot
│   ├── cart/                      # SoT for cart, two exposes (Panel + HeaderTrigger)
│   ├── ai-chat/                   # publishes `chat.*`, consumes SSE from backend
│   ├── notifications/             # WS→bus bridge + toast queue
│   └── checkout/                  # headless: listens to `cart.checkout.requested.v1`, shows iframe
├── shared/
│   ├── contracts/                 # TopicMap split per domain
│   └── mock-bus/                  # placeholder for @hedwigjs/broker
└── backend/                       # single Express process, ports 4000
    └── src/routes/{ai, notifications, checkout}.ts
```

Local ports (up-to-date):

| Service | URL |
| --- | --- |
| shell | http://localhost:3000 |
| menu | http://localhost:3001 |
| cart | http://localhost:3002 |
| ai-chat | http://localhost:3003 |
| notifications | http://localhost:3004 |
| checkout | http://localhost:3005 |
| analytics | http://localhost:3006 |
| backend | http://localhost:4000 |

Production URL: **[hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)** — nginx serves the shell + MFEs under one origin and proxies WS/SSE/checkout/health/notify to the same Node backend. See [`examples/advanced/deploy/nginx.conf`](../../../examples/advanced/deploy/nginx.conf).

## The bus mental model

The stand treats the bus as a **typed pub-sub over topic strings** with three
guarantees:

1. **Contract-first.** Every topic has an entry in `TopicMap`. `emit` /
   `on` are typed against it — a typo is a compile error, a wrong payload
   shape is a compile error.
2. **Cross-realm identity.** Under Module Federation each MFE bundles its own
   copy of the bus module. The `mock-bus` (and, later, `@hedwigjs/broker`) parks
   its store on `window['__HEDWIG_MOCK_BUS__']` so every MFE ends up talking
   to the same instance per browser realm.
3. **Replay on subscribe.** A late-joining subscriber can ask for the last
   emitted payload with `{ replay: true }`. Non-negotiable for late-mounted
   MFEs; without it, storefront would show empty counters until the next
   cart mutation.

Anti-guarantees worth naming:

- No historical replay beyond the last value.
- No delivery guarantees across page reloads or realms without shared
  `window`.
- No topic hierarchy or wildcards. `chat.*` is a documentation convention,
  not a subscription pattern.

## Domain contracts (`shared/contracts/`)

Split per domain, each file owns its topics fully:

- `domains/cart.ts` → `CartTopicMap` (item mutations, snapshot, checkout
  request). Also exports `CartItem` because it's a shared payload shape.
- `domains/checkout.ts` → `CheckoutTopicMap` (`checkout.completed.v1`,
  `checkout.cancelled.v1`).
- `domains/notifications.ts` → `NotificationTopicMap` +
  `NotificationKind` union.
- `domains/chat.ts` → `ChatTopicMap` (observability channel for AI-reply
  lifecycle).
- `domains/ui.ts` → `UITopicMap` (UI-only events with observability value).

`topics.ts` composes: `TopicMap = CartTopicMap & CheckoutTopicMap & …`.
Codegen from per-event contract files (planned for `@hedwigjs/registry`) will
replace this composition once we're moving in that direction.

Naming: `<domain>.<noun>.<verb>.<version>`. Version suffix is always `.vN`.

Cross-domain publishers are a design smell — a topic belongs to whoever
publishes it, and that owner writes the contract. Example: even though
`cart.checkout.requested.v1` "leads into" checkout, cart publishes it, so it
lives in `domains/cart.ts`.

## State ownership: three sizing choices

Every hook or store in the demo fits one of three shapes, and the choice is
deliberate.

### 1. Singleton runtime as SoT

Cart. State lives outside React, in a module-scope store parked on
`window['__HEDWIG_DEMO_CART_RUNTIME__']` so it's shared across all mounted
cart views. React components subscribe read-only via `useCartSnapshot()`.
Actions go through `cartActions.*` which emit bus events; the runtime
listens and updates state; the update fires `cart.snapshot.v1`; every view
re-renders.

**When to use:** two or more UI representations of the same state (cart
lives in both a right-column panel and a header-triggered popup — they must
stay in sync without one becoming the "primary" copy).

**Files:** `mfe/cart/src/state/{cartStore.ts, actions.ts, useCartSnapshot.ts}`.

### 2. Read-only projection

Storefront's per-item counters. `useLocalCartQuantities` subscribes to
`cart.snapshot.v1` with `{ replay: true }`, derives a `{ itemId → qty }` map
from the snapshot, and never mutates its own copy. Clicks publish commands
(`cart.item.added.v1` etc), the resulting snapshot from cart is what updates
the UI.

**When to use:** you need to display or derive from someone else's state
but must not own it. Late-mount friendly thanks to `replay`.

**File:** `mfe/storefront/src/hooks/useLocalCartQuantities.ts`.

### 3. Local React state

AI-chat conversation history. Nobody else needs to read chat messages;
they're an MFE-internal thing. `useChat` keeps `messages` in `useState`,
emits `chat.*` topics on the bus purely as an observability trace (for
future devtools timeline), but doesn't derive UI from them.

**When to use:** state is not shared with any other MFE and has no
meaningful lifecycle after unmount.

**File:** `mfe/ai-chat/src/hooks/useChat.ts`.

## Communication patterns in the wild

### Storefront ⇄ cart (SoT + projection)

```
storefront click "add"
  → mockBus.emit('cart.item.added.v1', { itemId, name, price })
    → cart runtime updates state, emits 'cart.snapshot.v1'
      → storefront's useLocalCartQuantities receives snapshot → re-renders qty pill
      → cart's CartPanel / CartHeaderTrigger receive snapshot → re-render lines
```

Neither MFE knows the other exists. Bus is the only contract.

### Checkout via cart click → iframe → back through bus

```
cart click "Оформить заказ"
  → cartActions.checkout({ items, totalPrice })
  → mockBus.emit('cart.checkout.requested.v1', { items, totalPrice })
    → checkout MFE (headless) shows CheckoutModal with cross-origin iframe (localhost:4000/checkout)
        → user submits payment inside iframe
          → iframe POSTs backend, then window.parent.postMessage({ source:'hedwig-checkout', topic:'checkout.completed.v1', payload })
            → checkout MFE validates origin + envelope
              → mockBus.emit('checkout.completed.v1', payload)
              → mockBus.emit('notification.show.v1', { kind:'success', title:`Заказ ${orderId} принят`, ... })
              → for each item: mockBus.emit('cart.item.removed.v1', { itemId })
                → cart runtime clears state, emits empty snapshot
                  → cart views + storefront counters reset
```

Three MFEs coordinate through the bus. Cart doesn't know checkout exists.
Storefront doesn't know either. Notifications MFE just happens to be listening.

### Notifications backend → bus (ad-hoc adapter)

```
backend WS pushes { topic:'notification.show.v1', payload, ts }
  → notifications MFE useNotificationsSocket parses envelope
    → mockBus.emit('notification.show.v1', payload)
      → useToastQueue receives → renders toast (auto-dismiss 6s)
```

This is a **transport adapter** in ad-hoc form. When
`@hedwigjs/adapter-websocket` ships (see RFC-0001), this becomes a two-line
`createWsAdapter({ url, parse })`.

## Transports (present-day picture)

Three transports are exercised, all wired by hand today:

- **WebSocket:** `mfe/notifications/src/hooks/useNotificationsSocket.ts` —
  connects to `ws://localhost:4000/ws/notifications`, exponential backoff
  reconnect, parses envelope, bridges into bus.
- **SSE (Server-Sent Events):** `mfe/ai-chat/src/ai/SseAiClient.ts` — reads
  `POST /ai/stream` chunk-by-chunk. Not a bus adapter — the streamed chunks
  are consumed directly by React state (case 3 above).
- **`postMessage` (cross-origin iframe):** `mfe/checkout/src/App.tsx` —
  validates `event.origin === IFRAME_ORIGIN` and envelope shape before
  bridging into the bus.

## Backend

Single Express process on port 4000, three route groups:

- `POST /ai/stream` (SSE): canned replies streamed as `start` / `chunk` /
  `done` events. Same reply-set as `MockAiClient` used to have.
- `WS /ws/notifications` + `POST /notify`: pushes random demo notifications
  every 25s to connected clients; `POST` is a dev trigger.
- `GET /checkout` (HTML) + `POST /checkout` (JSON): payment form served for
  iframe embedding + order acceptance stub.

Reference sample HTML in `backend/src/routes/checkout.ts` uses the same
tokens (Fraunces/Inter, Hedwig-Café palette) as the rest of the stand.

Backend intentionally emits pre-shaped envelopes on the WS channel — the
production philosophy is: adapters normalize whatever comes off the wire.
In this demo we control both ends, so we don't have to prove that adaptation
is possible with a hostile shape. The `useNotificationsSocket` file
demonstrates the pattern anyway.

## Known compromises (not bugs, deliberate trade-offs)

- **CSS design tokens live in `shell/src/styles/reset.css`.** MFE reference
  `--hdw-*` without declaring them. Works because shell loads first and
  `:root` is global. Architecturally this creates an implicit dependency
  from every MFE onto the shell. In production, extract to a shared package
  (`@hedwig-demo/tokens`) that every workspace imports explicitly. Kept as
  today for brevity.
- **Pill counter (`− N +`) is implemented three times** —
  `MenuPosition.tsx`, `MenuItemModal.tsx`, `CartList.tsx`. Not deduplicated
  because bus architecture is orthogonal to UI-kit reuse; introducing a
  shared UI package would blur the point of the demo. In production, extract
  to a design system.
- **`ai-chat` uses a raw SSE consumer, not the bus,** for streaming chunks.
  Reason: chunks are an inter-transport concern (chunk boundaries have no
  semantic meaning). Only the lifecycle events (`chat.message.sent.v1`,
  `chat.reply.*`) go on the bus, for observability.
- **`chat.*` topics currently have no subscribers.** They're an
  observability channel; devtools will consume them once shipped.
- **No formal transport adapters yet.** WS and `postMessage` bridges are
  hand-rolled. See RFC-0001 for the target abstraction.
- **`mock-bus` will be replaced** by `@hedwigjs/broker` verbatim. The API is
  already compatible (`emit`, `on(topic, h, { replay })`, cross-realm via
  `window`).
- **Standalone MFE-page mode** (`__CART_STANDALONE__` etc.) is scaffolding
  for iframe-based dev, not part of the demo story.

## Module Federation + single-spa in 30 seconds

- Shell = Module Federation *host*. `webpack.config.js:remotes` lists every
  MFE's `remoteEntry.js`.
- Each MFE = MF *remote*, exposes at least `./App` (cart exposes `./Panel`
  and `./HeaderTrigger`).
- Shell uses single-spa to register each remote as an application,
  `activeWhen: () => true`, with a custom `domElement` prop pointing at the
  slot it should mount into.
- `slots.ts` guarantees every slot has a wrapper `<div data-slot-mount>` —
  so a re-mounting MFE can wipe its own subtree without touching the
  shell's placeholder.

## Future-proofing checklist

When `@hedwigjs/broker` ships:

1. Replace `import { mockBus } from '@hedwig-demo/mock-bus'` →
   `import { getBroker } from '@hedwigjs/broker'` in every MFE.
2. Delete `shared/mock-bus/`.
3. Update contracts export: `@hedwig-demo/contracts` becomes a codegen
   target of `@hedwigjs/registry`.
4. Verify demo runs unchanged. If not — treat as a bug in `@hedwigjs/broker`
   compatibility, not in the demo.

When adapters ship (RFC-0001):

1. `mfe/notifications/src/hooks/useNotificationsSocket.ts` collapses to a
   `createWsAdapter({ url, parse })` call.
2. `mfe/checkout/src/App.tsx` postMessage handler moves into
   `@hedwigjs/adapter-postmessage`.
