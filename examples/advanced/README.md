# Hedwig Café — reference stand

**Live demo:** [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)

A food-delivery microfrontend app that exercises the full Hedwig feature
surface: shell + a handful of MFEs + Node backend, wired together
through `@hedwigjs/broker`, observed through `@hedwigjs/devtools`.
Contracts live in `@hedwig-demo/contracts` (topic map for the whole
stand).

Everything on the domain lives under `/demo/advanced/` — root `/`
302-redirects there. See
[`deploy/nginx.conf`](./deploy/nginx.conf) for the exact URL layout.

---

## Modules

### Frontend (browser, in-process broker)

| Module          | Client id             | Role                                                                              |
| --------------- | --------------------- | --------------------------------------------------------------------------------- |
| `shell`         | (host)                | Single-spa host. Installs ACL hooks, wires bridges (WS/SSE/BroadcastChannel), mounts DevTools |
| `menu`          | `menu`                | Dish grid. Sends `cart.add-item.v1` requests to the cart runtime                  |
| `cart`          | `cart-runtime`, `cart-ui` | Cart runtime + UI. Owns the cart state, publishes `cart.snapshot.v1` with history |
| `checkout`      | `checkout`            | Headless iframe controller. Handles `checkout.start.v1` request; PostMessage bridge to iframe |
| `notifications` | `notifications-toast` | Toast panel. Subscribes to `notification.show.v1`                                  |
| `ai-chat`       | `ai-chat`             | Streaming chat over SSE                                                            |
| `analytics`     | `analytics`           | Semi-trusted read-only tracker — used as the ACL demo target                       |
| `late-mount`    | `late-mount-demo`     | Extra card that mounts on demand — proves history-buffer replay                    |

### Backend (Node/Express, reaches the broker via transport bridges)

| Module                  | Bridge          | Role                                                             |
| ----------------------- | --------------- | ---------------------------------------------------------------- |
| `notifications-backend` | WebSocket       | Pushes `notification.show.v1` to every subscriber                 |
| `ai-backend`            | SSE             | Streams `chat.reply-chunk.v1` + `chat.reply-completed.v1`         |
| `checkout-iframe`       | PostMessage     | Iframe HTML at `/checkout` — sends `checkout.completed.v1` back  |

Backend modules speak the same topics as any frontend one; the only
tell in DevTools is an `external` pill on the message row.

---

## Running locally

From the repo root:

```bash
npm install
npm run dev:demo       # concurrently boots contracts, backend, shell + every MFE
npm run stop:demo      # kills every port
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

Language: default `en`. Toggle **EN · RU** in the header — page reloads
with the alternate translation and passes `?lang=` to WS/SSE/iframe so
the backend also localizes.

---

## Architecture in one paragraph

The shell boots one `initBroker()` and registers all bridges:
`WebSocketTransport` → `/ws/notifications`, `SSETransport` →
`/ai/stream`, `BroadcastChannelTransport` → cross-tab cart sync,
`PostMessageTransport` → checkout iframe. Each MFE creates its own
typed `Client<Topic, TopicPayloads>` — commands go through `request()`,
state broadcasts through `emit()` with `history: true` for late
subscribers. The shell installs `useOnSubscribeHook` +
`useBeforeSendHook` wired to a declarative ACL config, and mounts
`@hedwigjs/devtools` so message flow, subscribers, bridges, history and
hook rejections are all visible live at the bottom of the page.

---

## Layout

```
examples/advanced/
├── shell/                # bootstrap host: broker init, ACL, bridges, DevTools
├── mfe/
│   ├── menu/             # product grid
│   ├── cart/             # runtime + UI + late-mount demo (multiple bootstraps)
│   ├── checkout/         # headless iframe controller
│   ├── notifications/    # toast panel
│   ├── ai-chat/          # SSE-driven chat
│   └── analytics/        # ACL demo target
├── backend/              # express + ws server (notifications, AI, checkout)
├── shared/
│   ├── contracts/        # @hedwig-demo/contracts — topic registry
│   ├── i18n/             # tiny useLang() helper
│   └── hooks/            # shared React hooks (body scroll lock, …)
└── deploy/
    └── nginx.conf        # production nginx site config
```

---

## Deployment

Automated end-to-end. Any push to `main` that touches
`examples/advanced/**`, `packages/broker/**`, or `packages/devtools/**`
triggers
[`.github/workflows/deploy-stand.yml`](../../.github/workflows/deploy-stand.yml):

1. Build broker + devtools workspace deps.
2. Build shell + every MFE with prod env vars baked in (WS/SSE URLs,
   MFE remote base at `/demo/advanced/mfe`, checkout iframe URL).
3. Stage a `deploy/` tree mirroring `/var/www/hedwig/` layout.
4. Rsync to the VM over SSH; scp nginx config, reload nginx only if it
   changed.
5. Fingerprint-diff backend sources; systemd-restart the backend only
   when they actually changed.
6. Curl smoke test hits the shell HTML, two MFE `remoteEntry.js`
   files, `/health`, plus the root redirect. Failures propagate via
   `curl -sf` + `set -e`.

Secrets required (repository settings):
`HEDWIG_SSH_KEY`, `HEDWIG_VM_HOST`, `HEDWIG_VM_USER`.

Cert renewal is out-of-band (certbot systemd timer on the VM,
Let's Encrypt every ~60 days).

---

## What each part demonstrates

- **`cart-runtime` + `cart-ui`** — CQRS-style split. Mutations are
  targeted `request()`s to the runtime; UI reads state from
  `cart.snapshot.v1` via `emit({ history: true })`.
- **`late-mount`** — separate MF-bundle chunk that subscribes on demand
  with `replay: { limit: 1 }` and gets the current cart state
  immediately from the broker's ring buffer.
- **`analytics`** — ACL rejection surface. Buttons intentionally try to
  subscribe to `cart.snapshot.v1` or send `checkout.start.v1`; hooks
  fire back `NACK HOOK_REJECTED` (send) / throw (subscribe), and
  `subscription.rejected` + `message.rejected` land in the DevTools
  System Events tab as a distinct security channel.
- **`notifications-backend` (WS)** and **`ai-backend` (SSE)** — same
  broker semantics reachable across a transport bridge. Frontend
  subscribers don't know or care where the message originated.
- **Checkout iframe (PostMessage)** — bridge to a cross-origin document;
  `PostMessageTransport.allowedOrigins` acts as the trust boundary.
