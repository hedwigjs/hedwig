# Changelog

Project-level milestones for Hedwig. Packages are versioned
independently, so each milestone names the versions it shipped as.
Per-package release notes are maintained by
[Changesets](./.changeset/README.md) and land in each package's own
`CHANGELOG.md` on version bump —
[`broker`](./packages/broker/CHANGELOG.md),
[`client`](./packages/client/CHANGELOG.md),
[`react`](./packages/react/CHANGELOG.md),
[`vue`](./packages/vue/CHANGELOG.md),
[`devtools`](./packages/devtools/CHANGELOG.md),
[`create-registry`](./packages/create-registry/CHANGELOG.md).

An entry describes the state a release shipped in, not the intermediate
steps it took to get there. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) —
before 1.0 a minor bump may break.

## [Unreleased]

Nothing here changes a published package.

- Documentation site: [hedwigjs.com](https://hedwigjs.com) now serves a
  VitePress site (landing, getting started, guides, spec, API) at the
  root; the reference stand keeps `/demo/advanced/`.
- Reference stand: the cart shows dish names in the language they were
  added in.
- CI: the changeset check runs only when `packages/` actually changed, so
  a docs-only pull request no longer asks for a changeset.
- Benchmarks: six scenarios for the surface 0.2.0 and 0.3.0 added and the
  suite never covered — requests across the wire (`16`), envelope v1
  build/parse (`17`), `payloads: 'clone'` against the in-place freeze
  (`18`), `maxBytes` measured by the runtime vs reported by the transport
  (`19`), the SDK's lazy client queue and flush (`20`), and a `state`
  topic's retained value on subscribe (`21`). The published numbers in the
  READMEs were re-measured against them: the emit p99 had been quoted as
  the p50, and the DevTools observer costs ~2% of throughput rather than
  the "< 1%" claimed.

## [0.3.0] — 2026-09-14

`@hedwigjs/broker` and `@hedwigjs/client` at 0.3.0; `@hedwigjs/devtools`,
`@hedwigjs/react`, `@hedwigjs/vue` and `@hedwigjs/create-registry` at
0.2.1.

### Review fixes after 0.2.0

- Runtime: `maxBytes` applies to every transport (text transports report
  the wire length, structured-clone transports are measured as JSON when
  the limit is set); an inbound request's deadline bounds the local
  handler instead of being ignored; transports throw on a failed send so
  `remote.send.failed` fires; `on()` refuses a wildcard topic with a
  `TypeError` — patterns belong in `accepts` / `forward` and hooks; new
  `initBroker({ payloads: 'clone' })` for hosts that would rather pay for
  a `structuredClone` than freeze the emitter's object in place.
- SDK: `createClient` no longer throws at module scope on a stale host —
  it returns a blocked client answering `NACK RUNTIME_TOO_OLD`;
  `whenRuntimeReady()` rejects instead of throwing; a lazy client binds
  each subscription in isolation, so one rejected subscription no longer
  leaves the queued emits and requests stuck.
- create-registry: codegen reads `name` / `kind` / `response` /
  `retention` from the TypeScript AST of the contract's default export,
  so a payload field called `kind` or `response` no longer breaks the
  build.
- Reference stand: cart stores in separate tabs converge; the
  remote-request demo gets its own card.
- Docs: "retained value before first paint" qualified (it holds when the
  runtime is already there; a lazy client delivers it when it binds); no
  hard-coded versions in `SECURITY.md` and the spec; the API index is
  links only; the root README shows the React and Vue adapters.

## [0.2.0] — 2026-09-14

`@hedwigjs/broker`, `@hedwigjs/client`, `@hedwigjs/devtools`,
`@hedwigjs/react`, `@hedwigjs/vue` and `@hedwigjs/create-registry` all at
0.2.0. `@hedwigjs/client`, `@hedwigjs/react` and `@hedwigjs/vue` are new
packages. Breaking for anyone on 0.1.x: bridges are gone, modules import
the SDK instead of the runtime, and `history` on `emit()` is replaced by
retention declared in the contract.

### `@hedwigjs/client` — the SDK for modules

- New package. A module imports `createClient` / `createRemoteClient`,
  `whenRuntimeReady`, `hasCapability`, `getRuntimeInfo` and every public
  type from `@hedwigjs/client`; only the host depends on
  `@hedwigjs/broker`. The SDK has no runtime dependency: `initBroker()`
  registers a handle under `Symbol.for('@hedwigjs/runtime/1')` (one
  symbol per ABI) and dispatches `hedwig:runtime-ready`; the SDK locates
  it behind two gates (`RUNTIME_NOT_PROVIDED`, `RUNTIME_TOO_OLD` below
  the `MIN_RUNTIME` baked into each SDK release).
- Boot order is a non-issue: `createClient()` before `initBroker()`
  returns a lazy proxy that records subscriptions and queues emits and
  requests (bounded at 64; overflow → `NACK RUNTIME_NOT_READY`), then
  flushes in order on registration. `createRemoteClient()` needs a live
  runtime (`whenRuntimeReady()`).
- Runtime: public types moved to the SDK and are re-exported;
  `createClient` throws `CLIENT_ID_TAKEN` on a duplicate id unless
  `{ onConflict: 'reset' }`; a second runtime in a realm throws
  `RUNTIME_ALREADY_PROVIDED`; the handle is removed on `destroyBroker()`;
  `sdkVersion` rides on `client.registered` and in
  `inspect.getClients()`; capabilities `wire.v1`, `remote.requests`.

### React and Vue adapters

- `@hedwigjs/react`: `useClient` (created in a layout effect, destroyed
  on unmount, StrictMode-safe), `useTopic` (latest handler, no
  re-subscribe), `useStateTopic` (retained value before the first paint),
  `useRequest` (`send` + `pending` / `result`, answer typed by the
  contract), `useRemoteClient` (created while options are present,
  destroyed with the component), `useRuntimeReady`, `bindHooks`.
  React 18 / 19.
- `@hedwigjs/vue`: the same six as Vue 3 composables on `onScopeDispose`,
  `watch` and `shallowRef`, plus `bindComposables`; `useRemoteClient`
  follows a ref or a getter.

### Remote clients replace bridges

Anything behind a transport is now a *client*, not a bridge:
`broker.createRemoteClient(id, { transport, identity, accepts, forward })`.
`addBridge`, `BridgeConfig`, `BridgeTransport`, `BridgeInfo`,
`inspect.getBridges()`, the `bridge.*` system events and their log codes
are removed — remote clients are the only way across a wire.

- `Transport` interface with capability flags (`duplex`, `fanout`,
  `ready`, `onClose`). Built-ins report them: SSE is inbound-only,
  BroadcastChannel is fan-out, WebSocket exposes `ready` (OPEN) and
  `onClose`.
- `TransportDescriptor`: name a built-in by `kind` (`postmessage`,
  `message-port`, `websocket`, `sse`, `broadcast-channel`) and the
  runtime instantiates it, so transport code never lands in a module's
  bundle. The classes are no longer exported; a custom wire implements
  `Transport`. An unknown kind throws `TRANSPORT_UNSUPPORTED` listing what
  the runtime provides, and `broker.capabilities` advertises the same.
- Identity of inbound frames is decided on this side: `fixed` (default,
  one participant; a foreign `source` → `SOURCE_MISMATCH`), `allow`
  (listed sources only), `prefix` (foreign realm, `source` becomes
  `tab:cart-store`). `accepts` gates which topics a remote may inject —
  everything else is dropped before any hook (`TOPIC_NOT_ACCEPTED`).
- `forward()` is the remote's subscription: it runs `onSubscribe` hooks
  with the remote's id and throws on denial, so one ACL covers local and
  remote participants.
- Edge protection: `maxBytes`, `rateLimit`; every drop is published as
  `remote.frame.rejected { reason }`. A transport that throws or never
  opens yields `remote.send.failed` instead of rejecting the emitter.
- `postmessage` requires both `allowedOrigins` and `targetOrigin` — the
  `'*'` default and the deprecated `origin` field are gone.
  `WebSocketTransport.destroy()` closes a still-open socket: the remote
  client owns its transport.
- `message.via` names the remote that delivered a message (local-only,
  never on the wire). Local and remote clients share one id namespace
  (`CLIENT_ID_TAKEN`); `inspect.getClients()` lists remotes with a
  `remote` block; `remote.created` / `remote.destroyed` events.

### Wire envelope v1

- One frame format for everything that crosses a transport:
  [`docs/content/spec/envelope-v1.md`](./docs/content/spec/envelope-v1.md)
  plus a JSON Schema shipped in the package
  (`@hedwigjs/broker/spec/envelope-v1.schema.json`). Inbound frames are
  validated field by field, and the runtime's ingress check is proven
  equivalent to the schema by a shared corpus test.
- Outbound frames carry `v: 1`, `kind`, and `origin` (this realm's
  session id). Inbound: `v` other than 1 or an unknown `kind` →
  `UNSUPPORTED`; a frame with our own `origin` → `ECHO`; anything
  structurally wrong → `MALFORMED`. The producer's `id` lands as
  `message.wireId`, the `ext` block as `message.ext`.
- New spec pages: delivery semantics, threat model, support matrix.

### Requests across the wire

- `client.request(remote.id, …)` crosses the transport: a
  `kind: 'request'` frame with `correlationId` + `deadline`, answered by
  a `kind: 'response'` frame over the same transport, with pending
  entries kept on the remote client. Local outcomes: `TIMEOUT` (per call
  → remote default → broker default → 5000 ms; the far side may still
  run it), `REMOTE_GONE`, `BROKER_DESTROYED`, and immediate
  `TRANSPORT_ONE_WAY` / `TRANSPORT_FANOUT` for transports that cannot
  answer. Exactly one `afterSend`, with `via`.
- Requests from a remote are routed to the named local client and always
  answered: handler result, `HANDLER_FAILED`, `NOT_SUBSCRIBED`,
  `HOOK_REJECTED`, or `SERIALIZATION_FAILED` (unencodable return value).
  A request that came over one wire is never relayed to another remote.
- Trace on `$systemEvents`: `request.forwarded`, `response.received`
  (with latency), `request.timeout`, `response.sent`.

### Topic kinds in contracts

- `TopicContract` with `kind: 'event' | 'request' | 'state'`
  (`EventContract` stays as a deprecated alias). Requests declare their
  answer as `response`; state topics may set `retention: { last: 1 }`.
- Codegen validates kinds and emits `TopicKinds`, `EventTopic` /
  `RequestTopic` / `StateTopic`, `TopicResponses`, `TopicContracts` and
  the runtime map `TOPIC_KINDS`; a contract without `kind` is an event
  with a summary warning.
- SDK: `createClient<Topic, TopicPayloads, TopicContracts>()` — `emit`
  accepts only events and state, `request` only requests and infers the
  answer type; a wrong verb is a compile error. Without the third type
  parameter nothing changes.
- Runtime: `initBroker({ topics: TOPIC_KINDS })` hands every new
  subscriber the retained value of a `state` topic synchronously
  (`replayed: true`, `afterSend REPLAY_DELIVERED`); opt out per
  subscription with `{ retained: false }`. `inspect.getRetained()`,
  `state.retained` event.
- Unicast history is gone: `RequestOptions` is `{ timeout }` and a
  request is never recorded.

### Retention declared in the contract

- A contract may declare `retention: { last: N }`; the runtime keeps the
  last N messages of that topic in a buffer of its own and a subscriber
  replays them with `on(topic, fn, { replay })`. `state` topics keep
  their last value the same way. Events without `retention` are not kept
  — most do not need to be. `TOPIC_KINDS` carries the policy, so the host
  only passes it, and `history` in `initBroker` is reduced to caps
  (`maxPerTopic`, `ttl`, `enabled`).
- The `history` flag on `emit()` is gone, and origin no longer matters: a
  frame from a remote client is retained like a local emit, for events
  and state alike, so a state value pushed by the backend reaches a late
  local subscriber.

### Broker — fault isolation

Fixes to the delivery pipeline so that one failing consumer can no longer
take the bus down for everyone else.

- A throwing custom `logger` is isolated (`logger.failed` to console);
  `emit()` / `request()` no longer reject because a sink is down.
- Binary payloads (`Uint8Array`, `DataView`, `ArrayBuffer`, …) travel
  through the pipeline instead of throwing in `deepFreeze`. Documented
  that freezing happens in place on the emitter's object.
- Subscribing or unsubscribing during a dispatch is deterministic (DOM
  `EventTarget` semantics); a self-removing hook no longer skips the next
  hook. Re-entrant `emit()` documented as inline delivery.
- Replay is synchronous and ordered: history entries reach the handler
  before `on()` returns, live messages always come after, nothing is
  delivered twice. Async handler rejections during replay are logged.
- `initBroker()` works outside secure contexts (plain `http://` hosts):
  session ids fall back to `crypto.getRandomValues`.

### Broker — one instance per realm, version compatibility, debug gate

- The broker lives in a non-enumerable slot on `globalThis` together with
  its package version, so copies of the library that reach the page twice
  (Module Federation without `singleton: true`, two bundlers, ESM + CJS)
  share one instance. A compatible second copy (same minor before 1.0,
  same major after) is reported as `broker.duplicate_copy`; an
  incompatible copy throws from `initBroker` / `getBroker` /
  `createClient` and never creates a second bus. `VERSION`,
  `isCompatibleVersion`, `broker.version` and `inspect.getVersionInfo()`
  are exported. Scope is one realm: iframes and Workers keep their own
  broker plus a remote client between them.
- `broker.$debug.send` requires `initBroker({ debug: true })`; otherwise
  `NACK DEBUG_DISABLED`. Off by default so production bundles cannot
  inject spoofed traffic by accident.

### Broker — hook failure mode, request semantics, `noLocal`

- Guard hooks fail **closed** by default: a throwing `beforeSend` /
  `onSubscribe` hook is a denial (`NACK HOOK_REJECTED`, subscribe
  throws). `hooks: { failMode: 'open' }` restores the old skip. New
  `hook.failed` system event for every throwing hook.
- `request()` bypasses backpressure: the recipient's original handler
  answers every request. A second handler on a unicast pair is warned
  about once (`unicast.multiple_handlers`).
- `request()` accepts `timeout` (ms) and `BrokerConfig.request.timeout`
  sets a default; expiry resolves `NACK TIMEOUT` and the handler is not
  cancelled.
- `noLocal` subscription option (default `true`, the old behaviour);
  `noLocal: false` delivers a client its own emits.
- Backpressure strategies isolate async handler rejections;
  `handler.failed` and `backpressure.handler.failed` carry `messageId`,
  `topic`, `source`.

### DevTools

- Runs on the host's React: the peer range is `react` / `react-dom`
  `^18.2.0 || ^19.0.0` and every `react/*` / `react-dom/*` request is an
  external. Previously webpack inlined `react/jsx-runtime` from the copy
  installed at build time and a React 18 host crashed at first render
  (`Cannot read properties of null (reading 'useMemo')`).
  `packages/devtools/react18-smoke` — a standalone project with its own
  lockfile — renders the built bundle under React 18.3 in jsdom and is
  wired into `npm test`.
- The Bridges tab is gone. The Clients tab lists remote clients next to
  local ones with a `remote · <transport>` badge; the detail view shows
  transport, identity mode, whether requests are possible, `accepts`, the
  forwarded topics, the counters that used to live on a bridge, and the
  SDK version that created a local client.
- Messages: `via <remote>` instead of the bare `external` pill, the
  topic's kind from the registry on every row, a `retained` pill for a
  state topic's initial delivery, and `Via … · wire id …` plus the `ext`
  block in the details.
- System Events: `remote.created`, `remote.destroyed`,
  `remote.frame.rejected` (with reason and what the frame claimed) and
  `remote.send.failed` under a `remote` facet; `request.forwarded`,
  `response.received`, `request.timeout` and `response.sent` with
  `sent` / `received` badges; `hook.failed`; `state.retained`.
- Replay Buffer shows the declared table — `notification.show.v1 · event
  · 3 of 10` — instead of an undifferentiated ring.
- Protocol handshake with a header badge on mismatch, a "channel is off"
  notice in the Debug tab, and the `enabled` prop documented and coded as
  `false` by default (the previous `NODE_ENV` expression was evaluated at
  library build time).

### Transport conformance kit and end-to-end suite

- `@hedwigjs/broker/conformance`: `transportConformance(factory)` returns
  framework-agnostic `{ name, run }` cases (flags, `ready`, envelope
  round trip, ordering, duplex, unsubscribe, idempotent destroy,
  `onClose`); `createMemoryTransportPair()` is the reference pair. The
  built-in MessagePort, BroadcastChannel and WebSocket transports pass it
  in the broker's own suite; a deliberately broken transport fails it.
- Playwright suite `examples/advanced/e2e` (cart and retained state, ACL
  denials, SSE chat, WebSocket notification, request to the backend,
  checkout iframe, cross-tab, DevTools) in Playwright's own headless
  Chromium; `npm run e2e` boots the stand itself.

### Reference stand

- Runs on the SDK and remote clients only: every MFE depends on
  `@hedwigjs/client`, the shell no longer shares `@hedwigjs/broker`
  through Module Federation, and there is no `addBridge` left —
  `notifications-backend` over `{ kind: 'websocket' }` (registered before
  the socket opens; the runtime tears it down on close, reconnect stays
  in the shell), `tabs` over `{ kind: 'broadcast-channel' }` with
  `prefix` identity (a snapshot from another tab arrives as
  `tab:cart-store`), `checkout-iframe` over `{ kind: 'postmessage' }` with
  both origins, `ai-backend` over `{ kind: 'sse' }` per reply.
- `initBroker({ topics: TOPIC_KINDS })`; every client is
  `createClient<Topic, TopicPayloads, TopicContracts>`; five contracts
  are requests with a `response`, the cart snapshot is `state`, the rest
  are explicit events. The late-mount card demonstrates retained state
  against a live producer. `notification.show.v1` keeps 10 messages and
  the chat transcript topics keep 50.
- On the React adapter: cart snapshot, menu quantities and the late-mount
  card via `useStateTopic`; the remote-request card via `useClient` +
  `useRequest`; the checkout iframe via `useRemoteClient`; toasts via
  `useTopic`. The hand-written `useEffect` / `useRef` lifecycle code is
  gone.
- New contract `notification.status.v1`: the backend answers it over the
  WebSocket (connected clients, uptime) and a "Request to a remote" card
  under the cart shows the round trip, or `NACK TIMEOUT` when the backend
  is down.
- The backend emits v1 frames from one helper with a per-process `origin`
  and a `correlationId` per streamed AI reply; the checkout iframe stamps
  its own `origin` and posts to the parent's origin (passed as
  `?parentOrigin=`). `npm test` in the backend validates every frame
  against the schema (Node test runner + ajv).
- ACL gained rules for `tabs` (may be forwarded `cart.snapshot.v1`),
  `tab:cart-store` (may send it) and `remote-request-demo`; the analytics
  MFE surfaces the rejection channel (`subscription.rejected` +
  `message.rejected` in DevTools). DevTools is loaded through a dynamic
  `import()` in its own chunk and arms the debug channel explicitly.
- Bilingual UI (EN default, RU toggle) — backend AI replies, notification
  bodies and checkout iframe HTML all honour `?lang=` from the client.
  The header no longer shows a non-functional user avatar; the language
  toggle lives in its place.
- Cart mutations moved to CQRS style — a targeted `request()` to the cart
  runtime with typed `RoutingResult.data`.
- Mobile-safe modal scroll lock: nested modals (cart popup + checkout
  iframe + menu item modal) cooperate on a shared reference counter and
  use `position: fixed` + saved `scrollY`, so iOS Safari no longer leaves
  the page stuck after close.
- Served under `/demo/advanced/` on the production domain.

### CI, provenance, governance

- `ci.yml`: build in dependency order, `npm run typecheck` across every
  workspace, unit suites, a stale-codegen check for the contracts
  registry, the Playwright stand suite (report uploaded on failure), and
  a changeset check on pull requests.
- `release.yml` builds all public packages, runs the unit suites and
  publishes with npm provenance (`NPM_CONFIG_PROVENANCE`, OIDC
  `id-token`); Changesets opens the Version Packages PR automatically and
  publishes on merge. `deploy-stand.yml` builds client and react too and
  triggers on their paths.
- Governance minimum: `CODEOWNERS`, a pull-request checklist, Dependabot
  (npm weekly, actions monthly), `.nvmrc`, and a rewritten
  `CONTRIBUTING.md` with the everyday commands and the release rules.
- Root scripts: `npm run build` (client → broker → devtools) and
  `npm test` across packages and the demo backend.

### Infrastructure

- The reference stand is deployed to a Yandex Cloud VM with HTTPS
  (Let's Encrypt via certbot):
  [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced).
- GitHub Actions **Deploy reference stand** rebuilds shell + every MFE
  with prod URLs baked in, rsyncs to the VM, diff-syncs the nginx config,
  restarts the backend only when its fingerprint actually changed, then
  runs a curl smoke test.

### Docs

- Every `@hedwigjs/*` package README rewritten reference-library style
  (compact API tables, recipes, table of contents), and a documentation
  audit against the code: the runtime/SDK split, topic kinds with
  contract-declared retention, remote clients instead of bridges, the
  React/Vue adapters with bound hooks, and DevTools on React 18/19.
- New guide `contract-based-topics.md`; complete `RoutingReason` and
  system-event tables in the broker README; new
  [`examples/advanced/README.md`](./examples/advanced/README.md) as the
  authoritative overview of the reference stand.
- RFC-0003 marked implemented (open question 3 resolved: one contract
  type with `kind`). RFC-0001 and the mock-bus era guide
  `demo-architecture.md` retired with pointers.
- Hard-coded version numbers stripped from docs — `package.json` stays
  the single source of truth so docs don't drift on every bump.

## [0.1.1] — 2026-08-30

`@hedwigjs/broker` only. Docs-only refresh: the live reference stand
([hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced))
surfaced in every package README, hard-coded version numbers dropped, and
minor accuracy fixes (backend transport labels, a DevTools pill name). No
runtime changes.

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
