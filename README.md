# Hedwig

The messaging toolkit for the frontend — a contract-first broker with
pluggable transports and first-class observability.

Frontend messaging is fragmented: `postMessage`, `WebSocket`, `SSE`,
`BroadcastChannel`, `EventTarget`, custom events — each with its own API,
lifecycle, and error handling. And the moment events start flowing, nobody
can see what's happening: React DevTools shows components, Redux DevTools
shows one store — the event layer between microfrontends, iframes, workers,
and tabs is invisible.

Hedwig unifies transports behind one typed API and ships the observability
primitives (system events, inspector, devtools panel) to see, replay, and
debug event flow at runtime.

**Core packages:** `@hedwigjs/broker` (runtime), `@hedwigjs/devtools`
(observability panel), `@hedwigjs/adapter-*` (transport adapters — upcoming).

**Bring your own contracts.** Broker consumes `Topic` + `TopicPayloads`
TypeScript types from any source: a starter kit (`@hedwigjs/create-registry`),
Zod schemas, Protobuf codegen, GraphQL codegen, hand-written `TopicMap`, or a
mix. Registry is a pattern, not a mandate.

> Pre-release. No packages published yet; the reference stand runs today.

## Repository layout

```
hedwig/
├── packages/            # publishable @hedwigjs/* packages (upcoming)
├── examples/
│   └── advanced/        # kitchen-sink reference stand: shell + MFEs + backend
├── docs/
│   └── content/         # documentation source (introduction, guides, api, rfcs)
├── tooling/             # internal shared dev configs (upcoming)
└── scripts/             # release / maintenance scripts (upcoming)
```

Design decisions live under [`docs/content/rfcs/`](./docs/content/rfcs).

## The reference stand

`examples/advanced/` hosts a food-delivery-style demo ("Hedwig Café") that
exercises the whole feature surface: cross-MFE messaging, cross-realm
singleton store, replay subscriptions, WebSocket + SSE + `postMessage`
transports, headless controllers, and cross-origin iframe integration.

Ports:

| Service    | URL                     |
| ---------- | ----------------------- |
| shell      | http://localhost:3000   |
| storefront | http://localhost:3001   |
| cart       | http://localhost:3002   |
| ai-chat    | http://localhost:3003   |
| notifications | http://localhost:3004 |
| checkout   | http://localhost:3005   |
| backend    | http://localhost:4000   |

## Running

```bash
npm install
npm run dev:demo        # starts every service in parallel
npm run stop:demo       # frees ports 3000-3005, 4000
```

`Ctrl+C` in the dev terminal also stops the concurrent processes.

## License

[MIT](./LICENSE)
