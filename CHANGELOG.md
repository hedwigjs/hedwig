# Changelog

Project-level milestones for Hedwig. Per-package release notes are
maintained by [Changesets](./.changeset/README.md) and end up in each
package's own `CHANGELOG.md` on version bump — see
[`packages/broker/CHANGELOG.md`](./packages/broker/CHANGELOG.md),
[`packages/devtools/CHANGELOG.md`](./packages/devtools/CHANGELOG.md),
[`packages/create-registry/CHANGELOG.md`](./packages/create-registry/CHANGELOG.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Broker — fault isolation

Six fixes to the delivery pipeline so that one failing consumer can no
longer take the bus down for everyone else. Each landed as its own
commit with a changeset; per-package notes will appear in
`packages/broker/CHANGELOG.md` on the next version bump.

- A throwing custom `logger` is isolated (`logger.failed` to console);
  `emit()` / `request()` no longer reject because a sink is down.
- A transport that throws from `send()` no longer rejects the caller
  after local delivery or starves later bridges. New
  `bridge.send.failed` event on the logger and `$systemEvents`;
  DevTools shows it with a `failed` badge.
- Binary payloads (`Uint8Array`, `DataView`, `ArrayBuffer`, …) travel
  through the pipeline instead of throwing in `deepFreeze`. Documented
  that freezing happens in place on the emitter's object.
- Subscribing or unsubscribing during a dispatch is deterministic (DOM
  `EventTarget` semantics); a self-removing hook no longer skips the
  next hook. Re-entrant `emit()` documented as inline delivery.
- Replay is synchronous and ordered: history entries reach the handler
  before `on()` returns, live messages always come after, nothing is
  delivered twice. Async handler rejections during replay are logged.
- `initBroker()` works outside secure contexts (plain `http://` hosts):
  session ids fall back to `crypto.getRandomValues`.

### Broker — one instance per realm, version compatibility, debug gate

- The broker now lives in a non-enumerable slot on `globalThis`
  together with its package version, so copies of the library that
  reach the page twice (Module Federation without `singleton: true`,
  two bundlers, ESM + CJS) share one instance. A compatible second copy
  (same minor before 1.0, same major after) is reported as
  `broker.duplicate_copy`; an incompatible copy throws from
  `initBroker` / `getBroker` / `createClient` and never creates a second
  bus. `VERSION`, `isCompatibleVersion`, `broker.version` and
  `inspect.getVersionInfo()` are exported. Scope is one realm: iframes
  and Workers keep their own broker plus a bridge.
- `broker.$debug.send` requires `initBroker({ debug: true })`;
  otherwise `NACK DEBUG_DISABLED`. Off by default so production bundles
  cannot inject spoofed traffic by accident.
- DevTools: protocol handshake with a header badge on mismatch, the two
  new events in System Events, a "channel is off" notice in the Debug
  tab. `enabled` prop documented and coded as `false` by default (the
  previous `NODE_ENV` expression was evaluated at library build time).
- Reference stand loads DevTools through a dynamic `import()` in its
  own chunk and arms the debug channel explicitly.

### Broker — hook failure mode, request semantics, `noLocal`

- Guard hooks fail **closed** by default: a throwing `beforeSend` /
  `onSubscribe` hook is a denial (`NACK HOOK_REJECTED`, subscribe
  throws). `hooks: { failMode: 'open' }` restores the old skip. New
  `hook.failed` system event for every throwing hook.
- `request()` bypasses backpressure: the recipient's original handler
  answers every request. A second handler on a unicast pair is warned
  about once (`unicast.multiple_handlers`).
- `request()` accepts `timeout` (ms) and `BrokerConfig.request.timeout`
  sets a default; expiry resolves `NACK TIMEOUT`, the handler is not
  cancelled.
- `noLocal` subscription option (default `true`, the old behaviour);
  `noLocal: false` delivers a client its own emits.
- `history: true` on a request is deprecated (`request.history_deprecated`,
  warned once per topic); it will be removed with topic classes.
- Backpressure strategies isolate async handler rejections; `handler.failed`
  and `backpressure.handler.failed` carry `messageId`, `topic`, `source`.
- DevTools renders `hook.failed` in System Events.

### Broker — minimum bridge safety

- A `request()` never crosses a bridge any more: only multicasts are
  forwarded. Previously a unicast to an unregistered recipient resolved
  `NACK NOT_SUBSCRIBED` locally yet still executed on the other side.
- Inbound frames are validated field by field (`topic`, `source`,
  `target` non-empty strings, `data` present); anything else is dropped
  as `bridge.message.invalid { reason: 'MALFORMED' }` before any hook.
- New `BridgeConfig.allowedSources`: frames claiming a `source` outside
  the list are dropped as `SOURCE_NOT_ALLOWED`. The reference stand sets
  it on all three inbound bridges.
- Reference stand: the checkout iframe posts to the parent's origin
  (passed as `?parentOrigin=`) instead of `'*'`; the backend builds
  every frame through one `createEnvelope` helper with UUID ids instead
  of three hand-written copies with per-process counters.
- DevTools renders `bridge.message.invalid` in System Events.

### Broker — remote clients (RFC-0003 step 3a)

Anything behind a transport is now a *client*, not a bridge:
`broker.createRemoteClient(id, { transport, identity, accepts, forward })`
(also exported as `createRemoteClient`). `addBridge` still works in this
step; it goes away once DevTools and the reference stand have moved.

- `Transport` interface with capability flags (`duplex`, `fanout`,
  `ready`, `onClose`). Built-ins report them: SSE is inbound-only,
  BroadcastChannel is fan-out, WebSocket exposes `ready` (OPEN) and
  `onClose`. `BridgeTransport` is now an alias.
- `TransportDescriptor`: name a built-in by `kind` (`postmessage`,
  `message-port`, `websocket`, `sse`, `broadcast-channel`) and the runtime
  instantiates it. Unknown kinds throw `TRANSPORT_UNSUPPORTED` listing
  what the runtime provides; `broker.capabilities` advertises the same.
  New `MessagePortTransport` for workers and `MessageChannel`.
- Identity of inbound frames is decided on this side: `fixed` (default,
  one participant; foreign `source` → `SOURCE_MISMATCH`), `allow`
  (listed sources only), `prefix` (foreign realm, `source` becomes
  `tab:cart-store`). `accepts` gates which topics a remote may inject —
  everything else is dropped before any hook (`TOPIC_NOT_ACCEPTED`).
- `forward()` is the remote's subscription: it runs `onSubscribe` hooks
  with the remote's id and throws on denial, so one ACL covers local and
  remote participants. Requests never go to a remote (step 5).
- Edge protection: `maxBytes`, `rateLimit`; all drops are published as
  `remote.frame.rejected { reason }`. A transport that throws or never
  opens yields `remote.send.failed` instead of rejecting the emitter.
- `message.via` names the remote that delivered a message (local-only,
  never on the wire). Local and remote clients share one id namespace
  (`CLIENT_ID_TAKEN`); `inspect.getClients()` lists remotes with a
  `remote` block; `remote.created` / `remote.destroyed` events.

### DevTools and reference stand — remote clients (RFC-0003 step 3b)

- Clients tab lists remote clients next to local ones with a
  `remote · <transport>` badge; the detail view shows transport, identity
  mode, whether requests are possible, `accepts` and the forwarded
  topics. Sent/received counters for a remote count what came in through
  it (`via`) and what was forwarded to it.
- Messages tab shows `via <remote>` instead of the bare `external` pill.
- System Events tab renders `remote.created`, `remote.destroyed`,
  `remote.frame.rejected` (with reason and what the frame claimed) and
  `remote.send.failed` under a `remote` facet.
- Reference stand runs on remote clients only, no `addBridge` left:
  `notifications-backend` over `{ kind: 'websocket' }` (registered before
  the socket opens; the runtime tears it down on close, reconnect stays in
  the shell), `tabs` over `{ kind: 'broadcast-channel' }` with `prefix`
  identity (a snapshot from another tab arrives as `tab:cart-store`),
  `checkout-iframe` over `{ kind: 'postmessage' }` with both origins,
  `ai-backend` over `{ kind: 'sse' }` per reply. ACL gained rules for
  `tabs` (may be forwarded `cart.snapshot.v1`) and `tab:cart-store` (may
  send it); the same hooks now cover local and remote participants.

### Broker and DevTools — bridges removed (RFC-0003 step 3c)

- `addBridge`, `BridgeConfig`, `BridgeTransport`, `BridgeInfo`,
  `inspect.getBridges()`, the `bridge.*` system events and log codes are
  gone; remote clients are the only way across a wire. The bridge items
  in the two sections above (`bridge.send.failed`, minimum bridge
  safety) were intermediate steps and are superseded by
  `remote.send.failed` / `remote.frame.rejected`.
- Built-in transport classes are no longer exported: the runtime
  instantiates them from a `TransportDescriptor`. Custom wires implement
  `Transport`.
- `postmessage` requires both `allowedOrigins` and `targetOrigin`; the
  `'*'` default and the deprecated `origin` field are removed.
- `WebSocketTransport.destroy()` closes a still-open socket — the remote
  client owns its transport.
- DevTools: Bridges tab removed; its counters live on the remote
  client's card.

### Wire envelope v1 (RFC-0003 step 4)

- One frame format for everything that crosses a transport:
  `docs/content/spec/envelope-v1.md` plus a JSON Schema shipped in the
  package (`@hedwigjs/broker/spec/envelope-v1.schema.json`). The runtime's
  ingress check is proven equivalent to the schema by a shared corpus test.
- Outbound frames carry `v: 1`, `kind`, and `origin` (this realm's session
  id). Inbound: `v` other than 1 or an unknown `kind` → `UNSUPPORTED`; a
  frame with our own `origin` → `ECHO`; the producer's `id` lands as
  `message.wireId`, the `ext` block as `message.ext`.
- New spec pages: delivery semantics, threat model, support matrix.
- Reference stand: the backend emits v1 frames from one helper with a
  per-process `origin` and a `correlationId` per streamed AI reply; the
  checkout iframe stamps its own `origin`. `npm test` in the backend
  validates every frame against the schema (Node test runner + ajv).
- DevTools: message details show `Via … · wire id …` and the `ext` block.

### Requests across the wire (RFC-0003 step 5)

- `client.request(remote.id, …)` now crosses the transport: a
  `kind: 'request'` frame with `correlationId` + `deadline`, answered by
  a `kind: 'response'` frame over the same transport, pending entries
  kept on the remote client. Local outcomes: `TIMEOUT` (per call →
  remote default → broker default → 5000 ms; the far side may still run
  it), `REMOTE_GONE`, `BROKER_DESTROYED`, and immediate
  `TRANSPORT_ONE_WAY` / `TRANSPORT_FANOUT` for transports that cannot
  answer. Exactly one `afterSend`, with `via`.
- Requests from a remote are routed to the named local client and always
  answered: handler result, `HANDLER_FAILED`, `NOT_SUBSCRIBED`,
  `HOOK_REJECTED`, `SERIALIZATION_FAILED` (unencodable return value). A
  request that came over one wire is never relayed to another remote.
- Trace on `$systemEvents`: `request.forwarded`, `response.received`
  (with latency), `request.timeout`, `response.sent`. DevTools renders
  them with `sent` / `received` badges.
- Spec: `SERIALIZATION_FAILED` joins the closed response reasons; an
  explicit request targeting `*` is malformed; new "Requests" section.
- Reference stand: new contract `notification.status.v1`; the backend
  answers it over the WebSocket (connected clients, uptime); a "Request
  to a remote" card under the cart sends it and shows the round trip, or
  `NACK TIMEOUT` when the backend is down. ACL rule for
  `remote-request-demo`.

### `@hedwigjs/client` — the SDK for modules (RFC-0003 step 6)

- New package. Modules import `createClient` / `createRemoteClient` and
  every public type from `@hedwigjs/client`; it depends on nothing at
  runtime and locates the host's runtime through
  `Symbol.for('@hedwigjs/runtime/1')`. Gates: `RUNTIME_NOT_PROVIDED`,
  `RUNTIME_TOO_OLD` (`MIN_RUNTIME` baked into each SDK release).
- Boot order is a non-issue: `createClient()` before `initBroker()`
  returns a lazy proxy that records subscriptions, queues emits and
  requests (bounded, 64) and flushes in order on `hedwig:runtime-ready`.
  `createRemoteClient()` needs a live runtime (`whenRuntimeReady()`).
- Runtime: public types moved to the SDK (re-exported); `createClient`
  throws `CLIENT_ID_TAKEN` on a duplicate id unless
  `{ onConflict: 'reset' }`; `RUNTIME_ALREADY_PROVIDED` for a second
  runtime; handle removed on `destroyBroker()`; `sdkVersion` on
  `client.registered` and in `inspect.getClients()`; capabilities
  `wire.v1`, `remote.requests`.
- Reference stand: every MFE depends on `@hedwigjs/client` only; the
  shell no longer shares `@hedwigjs/broker` through Module Federation.
  The checkout iframe and the AI stream are created with the SDK's
  `createRemoteClient`.
- DevTools: client detail shows the SDK version that created it.
- Root scripts: `npm run build` (client → broker → devtools) and
  `npm test` across packages and the demo backend.

### Topic kinds in contracts (RFC-0003 step 7, block 1 — registry)

- `TopicContract` with `kind: 'event' | 'request' | 'state'`
  (`EventContract` stays as a deprecated alias). Requests declare their
  answer as `response`; state topics may set `retention: { last: 1 }`.
- Codegen validates kinds, emits `TopicKinds`, `EventTopic` /
  `RequestTopic` / `StateTopic`, `TopicResponses`, `TopicContracts` and
  the runtime map `TOPIC_KINDS`; contracts without `kind` are events
  with a summary warning.
- Reference stand contracts: five requests with `response`, the cart
  snapshot as `state`, the rest explicit events.

### Topic kinds in the SDK and the runtime (step 7, block 2)

- SDK: `createClient<Topic, TopicPayloads, TopicContracts>()` — `emit`
  accepts only events and state, `request` only requests and infers the
  answer type; a wrong verb is a compile error. Without the third
  parameter nothing changes.
- Runtime: `initBroker({ topics: TOPIC_KINDS })` retains the last local
  multicast of every `state` topic and hands it to each new subscriber
  synchronously (`replayed: true`, `afterSend REPLAY_DELIVERED`); opt out
  per subscription with `{ retained: false }`. `inspect.getRetained()`,
  `state.retained` event.
- Unicast history removed: `RequestOptions` is `{ timeout }`, a request
  is never recorded, the deprecation warning is gone.

### Topic kinds on the stand and in DevTools (step 7, block 3)

- Reference stand: `initBroker({ topics: TOPIC_KINDS })`; every client is
  `createClient<Topic, TopicPayloads, TopicContracts>`; the cart snapshot
  is emitted without `history: true` and read without `replay` — the
  late-mount card now demonstrates retained state.
- DevTools: kind from the registry on every message row, `retained` pill
  for a state topic's initial delivery, `state.retained` in System Events.
- Docs: guide `contract-based-topics.md`; broker README "Topic kinds and
  state"; RFC-0003 open question 3 resolved (one contract type with `kind`).

### React and Vue adapters (step 8)

- `@hedwigjs/react`: `useClient` (created in a layout effect, destroyed on
  unmount, StrictMode-safe), `useTopic` (latest handler, no re-subscribe),
  `useStateTopic` (retained value before the first paint), `useRequest`
  (`send` + `pending` / `result`, answer typed by the contract),
  `useRemoteClient` (created while options are present, destroyed with the
  component), `useRuntimeReady`.
- `@hedwigjs/vue`: the same six as composables on `onScopeDispose`,
  `watch` and `shallowRef`; `useRemoteClient` follows a ref or getter.
- Reference stand on the React adapter: cart snapshot, menu quantities and
  the late-mount card via `useStateTopic`; the remote-request card via
  `useClient` + `useRequest`; the checkout iframe via `useRemoteClient`;
  toasts via `useTopic`. The hand-written `useEffect` / `useRef` lifecycle
  code is gone.

### Transport conformance kit and end-to-end suite (step 9)

- `@hedwigjs/broker/conformance`: `transportConformance(factory)` returns
  framework-agnostic `{ name, run }` cases (flags, `ready`, envelope
  round trip, ordering, duplex, unsubscribe, idempotent destroy,
  `onClose`); `createMemoryTransportPair()` is the reference pair. The
  built-in MessagePort, BroadcastChannel and WebSocket transports pass it
  in the broker's own suite; a deliberately broken transport fails it.
- Reference stand: Playwright suite `examples/advanced/e2e` (cart and
  retained state, ACL denials, SSE chat, WebSocket notification, request
  to the backend, checkout iframe, cross-tab, DevTools) in Playwright's
  own headless Chromium; `npm run e2e` boots the stand itself.

### CI, provenance, governance (step 10)

- `ci.yml`: build in dependency order, `npm run typecheck` across every
  workspace, unit suites, stale-codegen check for the contracts registry,
  the Playwright stand suite (report uploaded on failure), and a
  changeset check on pull requests.
- `release.yml` builds all public packages, runs the unit suites and
  publishes with npm provenance (`NPM_CONFIG_PROVENANCE`, OIDC
  `id-token`). `deploy-stand.yml` builds client and react too and
  triggers on their paths.
- Governance minimum: `CODEOWNERS`, a pull-request checklist, Dependabot
  (npm weekly, actions monthly), `.nvmrc`, a rewritten `CONTRIBUTING.md`
  with the everyday commands and the release rules.

### DevTools on React 18 and 19

- `@hedwigjs/devtools` peer range is `react`/`react-dom`
  `^18.2.0 || ^19.0.0`. The sources never needed React 19; the bundle
  did, because webpack inlined `react/jsx-runtime` from the copy
  installed at build time, and a React 18 host crashed at first render
  (`Cannot read properties of null (reading 'useMemo')`). Every
  `react/*` and `react-dom/*` request is now an external, so the panel
  runs on the host's React.
- `packages/devtools/react18-smoke` — a standalone project (own
  lockfile, not a workspace) that renders the built bundle under React
  18.3 in jsdom; wired into `npm test` so the guard runs in CI.

### History records by default

- With `history.enabled`, every multicast event is recorded; the
  per-message `history: true` flag is no longer required (still
  accepted), and `history: false` opts a single message out. Requests
  and frames from remote clients are still never recorded. The DevTools
  Replay Buffer tab on the stand was always empty because no emit site
  set the flag after the move to `state` topics; now it shows what a
  late subscriber would replay.

### Bound hooks in the adapters

- `@hedwigjs/react`: `bindHooks(bus)` returns `useTopic`, `useStateTopic`
  and `useRequest` with the client closed over, so a module that owns one
  client at module scope calls `useStateTopic('cart.snapshot.v1')` with
  no client argument. `@hedwigjs/vue`: the same as `bindComposables`.
  The stand's cart, menu and notifications MFEs export their bound hooks
  from `clients/bus.ts`.

### Reference stand

- Bilingual UI (EN default, RU toggle). Backend AI replies + notification
  bodies + checkout iframe HTML all honour `?lang=` from the client.
- Whole stand now served under `/demo/advanced/` on the production
  domain — root `/` 302-redirects there.
- Late-mount MFE card demonstrates history-buffer replay against a
  live producer.
- Analytics MFE surfaces the ACL rejection channel
  (`subscription.rejected` + `message.rejected` in DevTools).
- Cart mutations moved to CQRS style — targeted `request()` to the
  cart runtime with typed `RoutingResult.data`.
- Mobile-safe modal scroll lock — nested modals (cart popup + checkout
  iframe + menu item modal) cooperate on a shared reference counter
  and use `position: fixed` + saved `scrollY` so iOS Safari doesn't
  leave the page stuck after close.
- Header no longer shows a non-functional user avatar; language toggle
  lives in its place.

### Infrastructure

- Deployed to a Yandex Cloud VM with HTTPS (Let's Encrypt via certbot).
  Live URL: [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced).
- GitHub Actions **Deploy reference stand** rebuilds shell + every MFE
  with prod URLs baked in, rsyncs to the VM, diff-syncs the nginx
  config, restarts the backend only when its fingerprint actually
  changed, then runs a curl smoke test.
- GitHub Actions **Release** wired to Changesets — opens the Version
  Packages PR automatically and publishes to npm on merge (requires
  `NPM_TOKEN` secret with `@hedwigjs` write + bypass 2FA).

### Docs

- Every `@hedwigjs/*` package README rewritten reference-library style
  (compact API tables, recipes, table of contents).
- New [`examples/advanced/README.md`](./examples/advanced/README.md) —
  authoritative overview of the reference stand.
- Head README gained the Live demo callout, up-to-date `What ships`
  table, and a Deployment section pointing at the workflow +
  versioned nginx config.
- Hardcoded version numbers stripped from docs — `package.json` stays
  the single source of truth so docs don't drift on every bump.
- Empty `scripts/` and `tooling/` placeholder dirs removed.

## [0.1.0] — 2026-08-29

Initial npm publish under the [`@hedwigjs`](https://www.npmjs.com/org/hedwigjs) org:

- **[`@hedwigjs/broker`](https://www.npmjs.com/package/@hedwigjs/broker)** — runtime broker.
  - Two message semantics: `emit()` (fan-out event) + `request()`
    (targeted call with typed response).
  - Four built-in transports: PostMessage, BroadcastChannel,
    WebSocket, SSE. Custom transports plug in via the 3-method
    `BridgeTransport` interface.
  - Hooks (`beforeSend`, `afterSend`, `onSubscribe`) for ACL, metrics,
    tracing, validation. `subscription.rejected` and
    `message.rejected` surface hook-driven denials as first-class
    system events.
  - Message history + opt-in `replay` for late subscribers.
  - Backpressure strategies (throttle, debounce, rate limit).
  - Observability surface: `broker.$systemEvents` (push) +
    `broker.inspect` (pull) + `broker.$debug.send()` (synthetic
    injection).
  - Structured logger (`BrokerLogger`) with stable event codes.
  - 15-scenario tinybench harness under
    [`packages/broker/benchmarks/`](./packages/broker/benchmarks/).
- **[`@hedwigjs/devtools`](https://www.npmjs.com/package/@hedwigjs/devtools)** — React DevTools panel.
  - Six tabs: Messages (with rollup for high-frequency bursts),
    Clients, Bridges, Replay Buffer, System Events, Debug (compose +
    send synthetic messages via `$debug.send`).
  - Accepts any `Record<name, TopicContractInfo>` registry for
    autocomplete + example payload prefill.
  - Docks to any edge; layout persists per user in localStorage.
- **[`@hedwigjs/create-registry`](https://www.npmjs.com/package/@hedwigjs/create-registry)** — initializer CLI.
  - `npm create @hedwigjs/registry <dir>` scaffolds a standalone
    TypeScript topic-registry package with codegen, one-event-per-file
    layout, and generated `Topic` / `TopicPayloads` / `TOPICS` /
    `registry` exports.
  - Produced package has zero runtime dependency on `@hedwigjs/*`.
