# Introduction

Reader-facing overview of Hedwig: what it is, what problem it solves, when
to reach for it.

## Framing

The two things Hedwig actually solves — and what the articles should
lead with:

1. **Transport unification.** Frontend messaging is a zoo — `postMessage`,
   `WebSocket`, `SSE`, `BroadcastChannel`, `EventTarget`, custom event
   systems, hand-rolled bridges. Every transport has its own API, error
   handling, and lifecycle. Hedwig gives you one contract-first API.
   Anything behind a wire joins as a **remote client** whose transport is
   named by a descriptor (`{ kind: 'websocket', socket }`); the caller
   writes the same `on` / `emit` / `request` either way.
2. **Observability in an event-driven world.** React DevTools shows
   components. Redux DevTools shows one store. The event layer between
   microfrontends, iframes, workers, and tabs is invisible today — there
   is no equivalent for "who sent what, to whom, when, and did it land."
   `$systemEvents` + `inspect` + `@hedwigjs/devtools` are built to close
   that gap.

Three things every article should get right:

- **Runtime and SDK are separate packages.** The host boots
  `@hedwigjs/broker` once; modules depend only on `@hedwigjs/client` (or
  `@hedwigjs/react` / `@hedwigjs/vue` on top of it). The SDK finds the
  runtime through a per-realm handle, so boot order does not matter — a
  module that starts before the host gets a lazy client that flushes in
  order once the runtime appears — and Module Federation does not have to
  share the broker.
- **Topics have a kind, declared in the contract.** `event` (a fact,
  broadcast to subscribers), `request` (one recipient, typed `response`),
  `state` (a current value: the runtime keeps the last one and hands it to
  every new subscriber inside `on()`). An event may declare
  `retention: { last: N }` so a late subscriber can ask for the last N with
  `on(topic, fn, { replay: { limit } })`. Nothing is flagged at the emit
  site; the host passes the registry once, `initBroker({ topics: TOPIC_KINDS })`.
- **The wire is specified.** Everything that crosses a transport is a wire
  envelope v1 frame — [`spec/envelope-v1.md`](../spec/envelope-v1.md), JSON
  Schema shipped as `@hedwigjs/broker/spec/envelope-v1.schema.json`. A
  backend in any language talks to a Hedwig runtime by producing frames
  that validate against the schema; no npm package needed.

## Planned articles

- `what-is-hedwig.md` — 60-second pitch anchored on the two problems above.
  Hero example: `initBroker({ topics })` in the host, `createClient` + one
  `emit`/`on` pair in a module.
- `why-a-frontend-broker.md` — deeper motivation. What breaks when teams
  hand-roll transport bridges + why observability isn't optional at scale.
- `mental-model.md` — topics and their kinds, subscribers, clients,
  retention and replay, cross-realm singleton, remote clients and
  transports.
- `comparison.md` — Hedwig vs `EventTarget`/`window.postMessage`, vs
  Redux/Zustand (state store, not transport), vs pub/sub-as-a-service
  (Ably/Pusher, hosted vs in-process), vs Kafka (comparison that gets
  drawn naturally — clarify what does and doesn't carry over).

Not written yet.
