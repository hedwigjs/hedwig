# Introduction

Reader-facing overview of Hedwig: what it is, what problem it solves, when
to reach for it.

## Framing

The two things Hedwig actually solves — and what upcoming articles should
lead with:

1. **Transport unification.** Frontend messaging is a zoo — `postMessage`,
   `WebSocket`, `SSE`, `BroadcastChannel`, `EventTarget`, custom event
   systems, ad-hoc bridges. Every transport has its own API, error handling,
   and lifecycle. Hedwig gives you one contract-first API; transports are
   adapters that plug in.
2. **Observability in an event-driven world.** React DevTools shows
   components. Redux DevTools shows one store. The event layer between
   microfrontends, iframes, workers, and tabs is invisible today — there
   is no equivalent for "who sent what, to whom, when, and did it land."
   `$systemEvents` + `inspect` + the upcoming `@hedwigjs/devtools` are
   built to close that gap.

## Planned articles

- `what-is-hedwig.md` — 60-second pitch anchored on the two problems above.
  Hero example: `initBroker` + `createClient` + one `emit`/`on` pair.
- `why-a-frontend-broker.md` — deeper motivation. What breaks when teams
  hand-roll transport bridges + why observability isn't optional at scale.
- `mental-model.md` — topics, subscribers, clients, replay, cross-realm
  singleton, adapters.
- `comparison.md` — Hedwig vs `EventTarget`/`window.postMessage`, vs
  Redux/Zustand (state store, not transport), vs pub/sub-as-a-service
  (Ably/Pusher, hosted vs in-process), vs Kafka (comparison that gets
  drawn naturally — clarify what does and doesn't carry over).

Not written yet.
