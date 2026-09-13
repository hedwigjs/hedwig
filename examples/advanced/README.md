# Hedwig Café — reference stand

**Live demo:** [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)

A food-delivery microfrontend app that exercises the full Hedwig feature
surface: shell + six MFEs + Node backend. The shell boots the runtime
(`@hedwigjs/broker`) and mounts `@hedwigjs/devtools`; every MFE talks to
the runtime through the SDK (`@hedwigjs/client`), the React ones through
`@hedwigjs/react` hooks. Contracts live in `@hedwig-demo/contracts` —
the topic registry for the whole stand (16 topics in 5 domains, see
[`shared/contracts/README.md`](./shared/contracts/README.md)).

Everything on the domain lives under `/demo/advanced/` — root `/`
302-redirects there. See
[`deploy/nginx.conf`](./deploy/nginx.conf) for the exact URL layout.

---

## Modules

### Frontend (browser, in-process broker)

| Module                | Client id               | Role                                                                              |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `shell`               | (host)                  | Single-spa host. Boots the broker with `TOPIC_KINDS`, installs ACL hooks, registers remote clients (WS / BroadcastChannel), mounts DevTools |
| `menu`                | `menu`                  | Dish grid. Sends `cart.add-item.v1` / `cart.decrement.v1` requests to the cart runtime |
| `cart`                | `cart-store`, `cart-ui` | Cart runtime + UI. Owns the cart state, publishes the `state` topic `cart.snapshot.v1` |
| `checkout`            | `checkout`              | Headless iframe controller. Handles the `checkout.start.v1` request; the iframe is a remote client over postMessage |
| `notifications`       | `notifications-toast`   | Toast panel. Subscribes to `notification.show.v1`                                  |
| `ai-chat`             | `ai-chat`               | Streaming chat over SSE                                                            |
| `analytics`           | `analytics`             | Semi-trusted read-only tracker — used as the ACL demo target                       |
| `late-mount`          | `late-mount-demo`       | Card in the cart bundle that mounts on demand — proves a `state` topic hands its retained value to late subscribers |
| `remote-request`      | `remote-request-demo`   | Own card below it (also from the cart bundle) — sends `notification.status.v1` to the backend over WebSocket and shows the answer (or `NACK TIMEOUT` when the backend is away) |

### Backend (Node/Express on port 4000, joins the broker as remote clients)

| Remote client id        | Transport                     | Role                                                                                  |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `notifications-backend` | WebSocket `/ws/notifications` | Pushes `notification.show.v1` to every subscriber; answers `notification.status.v1` requests with a response frame |
| `ai-backend`            | SSE `/ai/stream`              | Streams `chat.reply-chunk.v1` + `chat.reply-completed.v1`; one remote per reply       |
| `checkout-iframe`       | postMessage                   | Iframe HTML at `/checkout` — sends `checkout.completed.v1` back                       |

The backend also serves `GET /health` and a dev trigger `POST /notify`
(body `{ kind?, title, body? }`) that pushes a toast to every socket —
the e2e suite uses it.

Backend modules speak the same topics as any frontend one; the only
tell in DevTools is a `via <id>` pill on the message row (and a
`remote · <transport>` badge in the Clients tab).

---

## Running locally

From the repo root:

```bash
npm install
npm run build          # public packages once: the shell bundles broker + devtools, MFEs bundle client + react
npm run dev:demo       # concurrently boots contracts codegen (watch), backend, shell + every MFE
npm run stop:demo      # frees ports 3000–3006 and 4000
npm run restart:demo   # stop:demo, then dev:demo
```

Local URLs:

| Service         | URL                     |
| --------------- | ----------------------- |
| shell           | http://localhost:3000   |
| menu            | http://localhost:3001   |
| cart            | http://localhost:3002   |
| ai-chat         | http://localhost:3003   |
| notifications   | http://localhost:3004   |
| checkout        | http://localhost:3005   |
| analytics       | http://localhost:3006   |
| backend         | http://localhost:4000   |

End to end:

```bash
npx playwright install chromium   # once
npm run e2e                       # examples/advanced/e2e/stand.spec.ts — 8 tests
```

The Playwright config boots the stand itself (`webServer`) and reuses
one that is already running. The tests cover the cart requests and the
late-mount card, ACL rejections, SSE streaming, a backend toast over
WebSocket (via `POST /notify`), a request answered over WebSocket, the
iframe checkout, cross-tab sync and the DevTools panel.

Language: default `en`. Toggle **EN · RU** in the header — page reloads
with the alternate translation and passes `?lang=` to WS/SSE/iframe so
the backend also localizes.

---

## Architecture in one paragraph

The shell boots one `initBroker({ topics: TOPIC_KINDS })` — the registry
tells the runtime each topic's kind and retention — and registers the
participants that live behind a wire as **remote clients**
(`createRemoteClient`): `notifications-backend` over
`{ kind: 'websocket' }` → `/ws/notifications`, with
`accepts: ['notification.show.v1']`; `tabs` over
`{ kind: 'broadcast-channel' }` with `prefix` identity → cross-tab cart
sync. The checkout MFE registers its iframe (`checkout-iframe`,
`postmessage`) through `useRemoteClient`, and the AI chat registers one
`ai-backend` remote per reply (`sse`). Each MFE creates its own client
with `createClient<Topic, TopicPayloads, TopicContracts>` from
`@hedwigjs/client` — commands go through `request()`, the cart state
through `emit()` on the `state` topic `cart.snapshot.v1`, which the
runtime retains and hands to every new subscriber; `notification.show.v1`
and the chat transcript topics declare `retention`, so a late
subscriber can `replay`. The React MFEs bind their hooks once
(`bindHooks(bus)` in `clients/bus.ts`) and components call
`useStateTopic('cart.snapshot.v1')` or `useRequest(...)` without a
client argument. The shell installs `useOnSubscribeHook` +
`useBeforeSendHook` wired to a declarative deny-by-default ACL — the
same rules cover local and remote clients — and mounts
`@hedwigjs/devtools` behind a floating button on the right edge (closed
by default), so message flow, clients (remote ones with a `remote`
badge), the replay buffer, system events and hook rejections are all
visible live.

---

## Layout

```
examples/advanced/
├── package.json          # concurrently orchestrator: dev / stop / restart / e2e
├── playwright.config.ts  # boots the stand (webServer) and runs e2e/ in Playwright's Chromium
├── e2e/
│   └── stand.spec.ts     # 8 end-to-end tests
├── shell/                # bootstrap host: broker init, ACL, remote clients, DevTools
├── mfe/
│   ├── menu/             # product grid
│   ├── cart/             # runtime + UI + late-mount / remote-request demos (multiple bootstraps)
│   ├── checkout/         # headless iframe controller
│   ├── notifications/    # toast panel
│   ├── ai-chat/          # SSE-driven chat
│   └── analytics/        # ACL demo target
├── backend/              # express + ws server (notifications, AI, checkout)
├── shared/
│   ├── contracts/        # @hedwig-demo/contracts — topic registry (codegen from src/domains/**)
│   ├── i18n/             # tiny useLang() helper
│   └── hooks/            # shared React hooks (body scroll lock)
└── deploy/
    └── nginx.conf        # production nginx site config
```

---

## Deployment

Automated end-to-end. Any push to `main` that touches
`examples/advanced/**`, `packages/client/**`, `packages/broker/**`,
`packages/devtools/**`, `packages/react/**` or the workflow file itself
triggers
[`.github/workflows/deploy-stand.yml`](../../.github/workflows/deploy-stand.yml)
(it can also be run by hand via `workflow_dispatch`):

1. Build the public packages (`npm run build`).
2. Build shell + every MFE with prod env vars baked in (WS/SSE URLs,
   MFE remote base at `/demo/advanced/mfe`, checkout iframe URL).
3. Stage a `deploy/` tree mirroring the `/var/www/hedwig/` layout.
4. Rsync to the VM over SSH; scp nginx config, reload nginx only if it
   changed.
5. Fingerprint-diff backend sources; reinstall deps and systemd-restart
   the backend only when they actually changed.
6. Curl smoke test hits the shell HTML, the `menu` and `cart`
   `remoteEntry.js` files, `/health`, plus the root redirect. Failures
   propagate via `curl -sf` + `set -e`.

Secrets required (repository settings):
`HEDWIG_SSH_KEY`, `HEDWIG_VM_HOST`, `HEDWIG_VM_USER`.

Cert renewal is out-of-band (certbot systemd timer on the VM,
Let's Encrypt every ~60 days).

---

## What each part demonstrates

- **`cart-store` + `cart-ui`** — CQRS-style split. Mutations are
  targeted `request()`s to the runtime (`cart.add-item.v1`,
  `cart.decrement.v1`, `cart.remove-item.v1`, each with a typed answer);
  the UI reads state through `useStateTopic('cart.snapshot.v1')`. It is a
  `state` topic: the runtime keeps the last snapshot and hands it to
  every new subscriber synchronously inside `on()` — nothing at the emit
  site, no `replay` option.
- **`late-mount`** — separate MF chunk (`cart/LateMount`) that mounts on
  demand. `useClient('late-mount-demo')` +
  `useStateTopic(client, 'cart.snapshot.v1')`: the current cart arrives
  with the subscription, flagged `replayed: true`; the producer re-emits
  nothing.
- **`remote-request`** — separate MF chunk (`cart/RemoteRequest`), own card.
  `useRequest(bus, 'notifications-backend',
  'notification.status.v1', { timeout: 3000 })`. The request crosses
  the WebSocket as a frame with a `correlationId` and a deadline; the
  backend answers with a response frame matched by that id. Stop the
  backend and the request resolves `NACK TIMEOUT` locally.
- **Retention** — `notification.show.v1` keeps its last 10,
  `chat.message-sent.v1` and `chat.reply-completed.v1` their last 50 —
  declared in the contracts, nothing in the host. The DevTools **Replay
  Buffer** tab lists every retaining topic with its limit and current
  fill (`cart.snapshot.v1 · 1 of 1`, `notification.show.v1 · 3 of 10`).
- **`analytics`** — ACL rejection surface. Buttons intentionally try to
  subscribe to `cart.snapshot.v1` or send `checkout.start.v1`; hooks
  fire back `NACK HOOK_REJECTED` (send) / throw (subscribe), and
  `subscription.rejected` + `message.rejected` land in the DevTools
  System Events tab as a distinct security channel.
- **`notifications-backend` (WS)** and **`ai-backend` (SSE)** — remote
  clients: same broker semantics across a transport. Frontend subscribers
  don't know or care where the message originated; DevTools shows
  `via <id>` on each such message.
- **Checkout iframe (postMessage)** — a remote client in a cross-origin
  document, created for exactly as long as the modal shows a loaded
  iframe (`useRemoteClient`); `allowedOrigins` (inbound) and
  `targetOrigin` (outbound) are both mandatory and act as the trust
  boundary.
- **Other tabs (BroadcastChannel)** — one remote client `tabs` with
  `prefix` identity: a snapshot from another tab's `cart-store` arrives
  as `tab:cart-store`, so the ACL can tell it from the local one.
