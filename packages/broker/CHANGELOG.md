# @hedwigjs/broker

## 0.3.0

### Minor Changes

- [#23](https://github.com/hedwigjs/hedwig/pull/23) [`4c76703`](https://github.com/hedwigjs/hedwig/commit/4c767036d5f5d6422e3780b2857435f75c1fd6cf) Thanks [@pipinov](https://github.com/pipinov)! - Fixes from the post-0.2.0 code review.

  Runtime: `maxBytes` now applies to every transport (text transports report
  the wire length via the new optional `TransportFrameMeta` argument of the
  `onMessage` callback, structured-clone transports are measured as JSON when
  the limit is set); an inbound request's deadline bounds the local handler
  (budget = deadline − timestamp, in the sender's clock) instead of being
  ignored; WebSocket, postMessage and BroadcastChannel transports throw on a
  failed send so `remote.send.failed` can fire (send after destroy stays a
  no-op); `on()` refuses a wildcard topic with a `TypeError` — patterns are
  for `accepts` / `forward` and hooks; new `initBroker({ payloads: 'clone' })`
  copies payloads with `structuredClone` before freezing, for hosts that
  would rather pay for a copy than freeze the emitter's object in place.

  SDK: `createClient` no longer throws `RUNTIME_TOO_OLD` at module scope —
  it returns a blocked client whose calls answer `NACK RUNTIME_TOO_OLD` (new
  routing reason) and logs once; `whenRuntimeReady()` rejects instead of
  throwing when the runtime present is too old; a lazy client binds each
  subscription in isolation, so one rejected subscription no longer leaves
  the queued emits and requests stuck.

  create-registry: the generator reads `name` / `kind` / `response` /
  `retention` from the TypeScript AST of the contract's default export, so a
  payload with a field called `kind` or `response` no longer breaks the build.

  Docs: "retained value before first paint" is qualified (holds when the
  runtime is already there; a lazy client delivers it when it binds).

### Patch Changes

- Updated dependencies [[`4c76703`](https://github.com/hedwigjs/hedwig/commit/4c767036d5f5d6422e3780b2857435f75c1fd6cf)]:
  - @hedwigjs/client@0.3.0

## 0.2.0

### Minor Changes

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`09d194b`](https://github.com/hedwigjs/hedwig/commit/09d194b4a951206ca0d5d0dd634d227f75212b22) Thanks [@pipinov](https://github.com/pipinov)! - New package `@hedwigjs/client` — the SDK a module uses: `createClient`,
  `createRemoteClient`, `whenRuntimeReady`, `hasCapability`,
  `getRuntimeInfo`, `RoutingReason`, and every type a module can see
  (`Client`, `RemoteClient`, `Message`, `RoutingResult`, `Transport`,
  `TransportDescriptor`, options). It depends on nothing at runtime: the
  host's `initBroker()` registers a handle under
  `Symbol.for('@hedwigjs/runtime/1')` (one symbol per ABI) and dispatches
  `hedwig:runtime-ready`; the SDK locates it with two gates
  (`RUNTIME_NOT_PROVIDED`, `RUNTIME_TOO_OLD` below `MIN_RUNTIME`).
  `createClient()` works before the runtime exists — a lazy proxy records
  subscriptions and queues emits/requests (bounded, 64; overflow →
  `NACK RUNTIME_NOT_READY`) and flushes in order on registration.

  Runtime: the public types now live in the SDK and are re-exported;
  `createClient(id, { onConflict })` defaults to **throw** `CLIENT_ID_TAKEN`
  on a duplicate id (`'reset'` restores the old HMR behaviour); a second
  runtime in a realm throws `RUNTIME_ALREADY_PROVIDED`; `destroyBroker()`
  removes the handle; `client.registered` and `inspect.getClients()` carry
  `sdkVersion`; capabilities gain `wire.v1` and `remote.requests`. Module
  Federation guidance: the host does not share `@hedwigjs/broker`.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`7d54327`](https://github.com/hedwigjs/hedwig/commit/7d54327b3d99971109c3de8da1ce009485374d63) Thanks [@pipinov](https://github.com/pipinov)! - Guard hooks now fail **closed**: a `beforeSend` or `onSubscribe` hook that
  throws is treated as a denial (`NACK HOOK_REJECTED`; `on()` throws), so a
  crashing ACL can no longer let traffic through. `initBroker({ hooks: {
failMode: 'open' } })` restores the previous skip-and-continue behaviour.
  Every throwing hook, guard or observer, is reported as a `hook.failed`
  system event and log line.

  `request()` bypasses backpressure: the recipient's original handler
  answers every request, so a throttled / debounced / rate-limited
  subscription no longer resolves `ACK` with no data for requests. A second
  handler registered on a unicast pair is warned about once.

  New `RequestOptions.timeout` (ms) and `BrokerConfig.request.timeout`
  default: on expiry the request resolves `NACK TIMEOUT` (new reason); the
  handler is not cancelled. New `SubscriptionOptions.noLocal` (default
  `true`, unchanged behaviour); `noLocal: false` delivers a client its own
  emits. `history: true` on a request logs a one-time deprecation.

  Backpressure strategies isolate async handler rejections (previously an
  unhandled promise rejection). `handler.failed` and
  `backpressure.handler.failed` log meta now include `messageId`, `topic`
  and `source`.

  DevTools renders `hook.failed` in the System Events tab, distinguishing a
  crashed policy from a deliberate rejection.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`57315bb`](https://github.com/hedwigjs/hedwig/commit/57315bbafa259bd6c4e3f9d1646cbb23f22a1f1a) Thanks [@pipinov](https://github.com/pipinov)! - `broker.$debug.send` is now opt-in. Boot the broker with
  `initBroker({ debug: true })` to arm the channel; without it `send()`
  resolves `NACK DEBUG_DISABLED` without entering the pipeline and logs
  `debug.disabled`. `$debug.enabled` exposes the state. Off by default so
  a production bundle cannot inject spoofed-source messages by accident
  (the DevTools Debug tab, integration tests and nothing else use this
  channel). This is accident prevention, not a security boundary.

  DevTools: the Debug tab shows an explanatory "channel is off" notice
  with the one-line fix instead of a composer that only produces NACKs.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`67b1b6b`](https://github.com/hedwigjs/hedwig/commit/67b1b6b823f13352e6bc9b97c160729b6574c332) Thanks [@pipinov](https://github.com/pipinov)! - Remote clients replace bridges. `broker.createRemoteClient(id, { transport,
identity, accepts, forward })` registers a participant that lives behind a
  transport as a first-class client: the same id namespace, the same
  `onSubscribe` / `beforeSend` hooks, listed by `inspect.getClients()` with a
  `remote` block. Built-in transports are named by descriptor
  (`{ kind: 'websocket', socket }`, `message-port`, `postmessage` with
  mandatory `allowedOrigins` + `targetOrigin`, `sse`, `broadcast-channel`)
  and instantiated by the runtime; custom ones implement the `Transport`
  interface (`send` / `onMessage` / `destroy` plus optional `duplex`,
  `fanout`, `ready`, `onClose`). Inbound identity is decided on this side
  (`fixed` | `allow` | `prefix`), `accepts` gates injectable topics, and
  every drop surfaces as `remote.frame.rejected`; a transport that throws or
  never opens yields `remote.send.failed` instead of rejecting the emitter.
  `message.via` names the delivering remote.

  Removed: `addBridge`, `BridgeConfig`, `BridgeTransport`, `BridgeInfo`,
  `inspect.getBridges()`, the `bridge.*` system events and log codes, and
  the exported transport classes. `WebSocketTransport.destroy()` now closes
  a still-open socket, since the remote client owns its transport.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`1b0b1f1`](https://github.com/hedwigjs/hedwig/commit/1b0b1f1e1931f9135615af4cd8e4c1db54408fe9) Thanks [@pipinov](https://github.com/pipinov)! - Requests across the wire. `client.request(remote.id, …)` to a remote
  client sends a `kind: 'request'` frame with `correlationId` and `deadline`
  and resolves with the `kind: 'response'` frame that comes back over the
  same transport; pending entries live on the remote client. New routing
  reasons: `TIMEOUT` (local timer; per call → `RemoteClientOptions.timeout`
  → `BrokerConfig.request.timeout` → 5000 ms), `REMOTE_GONE`,
  `TRANSPORT_ONE_WAY`, `TRANSPORT_FANOUT`, `SERIALIZATION_FAILED`;
  `BROKER_DESTROYED` for requests pending at teardown. Requests that arrive
  from a remote are routed to the named local client and always answered —
  handler result, `HANDLER_FAILED`, `NOT_SUBSCRIBED`, `HOOK_REJECTED`,
  `SERIALIZATION_FAILED`. Trace events: `request.forwarded`,
  `response.received { latencyMs }`, `request.timeout`, `response.sent`.
  `buildResponse` / `toWireReason` exported; the schema gains
  `SERIALIZATION_FAILED` and refuses an explicit request targeting `*`.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`7b1888e`](https://github.com/hedwigjs/hedwig/commit/7b1888e95f654cb6076011c83abd6e162abf9913) Thanks [@pipinov](https://github.com/pipinov)! - Retention is declared in the contract, not at the emit site. An event
  contract may say `retention: { last: N }`; the runtime then keeps the last
  N messages of that topic — in a buffer of its own, so a chatty topic never
  evicts another — and a subscriber gets them with `on(topic, fn, { replay })`.
  `state` topics keep their last value the same way. Events without
  `retention` are not kept. The registry's `TOPIC_KINDS` carries the
  policy, so `initBroker({ topics: TOPIC_KINDS })` is all a host does; it
  may only cap (`history.maxPerTopic`, `ttl`) or switch event retention off
  (`history.enabled: false`). Origin no longer matters: a frame from a
  remote client is retained like a local emit, for events and state alike.

  Removed: the `history` flag on `emit()` and `history.enabled/maxSize` as
  the way to turn retention on. `inspect.getHistoryStats()` now lists every
  retaining topic with its limit and fill; the DevTools Replay Buffer tab
  renders that table. The log code `broker.replay.history_disabled` is now
  `broker.replay.no_retention` (replay asked on a topic that keeps nothing).

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`2643013`](https://github.com/hedwigjs/hedwig/commit/2643013093319fb93332dff6e49d6c36f718bb1d) Thanks [@pipinov](https://github.com/pipinov)! - Topic kinds in the SDK and the runtime. `createClient<Topic, TopicPayloads,
TopicContracts>()` makes the verbs kind-aware: `emit` accepts only events
  and state, `request` only requests and infers the answer type from the
  contract's `response`; without the third parameter every topic stays open
  to both verbs. `state` topics are retained by the runtime
  (`initBroker({ topics: TOPIC_KINDS })`): the last local multicast per
  state topic is kept, `inspect.getRetained()` lists them, a
  `state.retained` system event fires, and every new `on()` receives the
  value synchronously as `replayed: true` (opt out with
  `{ retained: false }`; a `replay` option takes precedence). `history` on
  `request()` is gone — a request is never recorded, `RequestOptions` is
  `{ timeout }` only, and the `request.history_deprecated` warning with it.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`12d5ded`](https://github.com/hedwigjs/hedwig/commit/12d5dedc952abac3a506f2b23ed9c6d607436b1d) Thanks [@pipinov](https://github.com/pipinov)! - `@hedwigjs/broker/conformance`: a framework-agnostic list of checks every
  `Transport` must pass (`transportConformance(factory)` → `{ name, run }`
  cases; `createMemoryTransportPair()` as the reference pair). The built-in
  MessagePort, BroadcastChannel and WebSocket transports run it in the
  package's own suite.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`3cdc91d`](https://github.com/hedwigjs/hedwig/commit/3cdc91d76bb0390ed7a1aa0330469a07ffa29a80) Thanks [@pipinov](https://github.com/pipinov)! - Wire envelope v1. Every frame that crosses a transport now follows one
  spec (`docs/content/spec/envelope-v1.md`) with a JSON Schema shipped as
  `@hedwigjs/broker/spec/envelope-v1.schema.json`: `v`, `id`, `origin`,
  `kind` (`event` | `request` | `response`), `topic`, `source`, `target`,
  `data`, `timestamp`, optional `correlationId`, `deadline`, `ext`. Outbound
  frames are built from the message with this realm's session id as
  `origin`; inbound frames pass a structural check equivalent to the schema
  (proved by test), a `v` / `kind` support check (`UNSUPPORTED`) and an echo
  guard (`ECHO` when `origin` is our own). The producer's id lands on the
  message as `wireId`, the `ext` block as `ext`; `ext.hedwig.claimedSource`
  records what a fixed-identity peer claimed. `parseFrame`, `buildFrame`,
  `WIRE_VERSION` and the wire types are exported. Missing `v` / `kind` stay
  tolerated for one wire version.

### Patch Changes

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`51ae14d`](https://github.com/hedwigjs/hedwig/commit/51ae14d2529ece411fb96f1b35037dc7c7b04a83) Thanks [@pipinov](https://github.com/pipinov)! - Fault isolation: a throwing custom `logger` no longer takes the pipeline
  down. Every internal `logger.warn` / `logger.error` call is now wrapped —
  if the user-supplied sink throws (Sentry offline, serializer choked, …),
  the failure is reported once to `console.error` as `logger.failed` and
  `emit()` / `request()` resolve normally instead of rejecting.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`2134e4b`](https://github.com/hedwigjs/hedwig/commit/2134e4b59db384663c5e71c86c400584d3a6b3e2) Thanks [@pipinov](https://github.com/pipinov)! - Binary payloads no longer break `emit()` / `request()`. The immutability
  step (`deepFreeze`) used to call `Object.freeze` on every nested value,
  which throws on typed arrays with elements — any message carrying a
  `Uint8Array`, `Float64Array`, `DataView` or `ArrayBuffer` rejected the
  pipeline, including frames arriving from a remote client via structured
  clone. Binary values are now left mutable and skipped; the envelope and
  every non-binary part of the payload are still frozen.

  Also documented: freezing happens in place on the object the emitter
  passed, not on a copy.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`3730090`](https://github.com/hedwigjs/hedwig/commit/373009014b9b657b4ecc49860faf9d119f1d8fdd) Thanks [@pipinov](https://github.com/pipinov)! - Deterministic dispatch when handlers subscribe or unsubscribe mid-flight.
  `Router.multicast` and the hook registry iterated live arrays; a handler
  (or hook) that unsubscribed a sibling during delivery spliced the array
  under the loop and silently skipped the next entry, while a client
  subscribed during delivery received the in-flight message. Both now
  iterate a snapshot taken before the first handler runs, with DOM
  `EventTarget` semantics: a handler unsubscribed mid-dispatch is not
  invoked (`off()` is immediate), a handler subscribed mid-dispatch starts
  with the next message. Re-entrant `emit()` from inside a handler is
  documented as inline delivery.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`8b5ebfd`](https://github.com/hedwigjs/hedwig/commit/8b5ebfd1a5e0fd312641aab78e4ed2321c0c75e9) Thanks [@pipinov](https://github.com/pipinov)! - One broker per realm, even when the library is bundled more than once.
  The instance now lives in a non-enumerable slot on `globalThis`
  (`Symbol.for('@hedwigjs/broker')`) together with the package version of
  the copy that created it, so copies of `@hedwigjs/broker` that reach the
  page through Module Federation without `singleton: true`, through two
  bundlers, or through the ESM + CJS dual-package hazard all resolve to
  the same broker. A compatible second copy (same minor before 1.0, same
  major after) is reported once as `broker.duplicate_copy`; an
  incompatible copy throws from `initBroker` / `getBroker` /
  `createClient` with both versions in the message and never creates a
  second bus. `VERSION`, `isCompatibleVersion`, `broker.version` and
  `inspect.getVersionInfo()` expose the diagnostics. Iframes and Workers
  are separate realms: they keep their own broker plus a remote client.

  DevTools performs a version handshake on attach and shows a header
  badge when the core's version is incompatible with the one the panel
  was built against; `broker.duplicate_copy` appears in the System Events
  tab, hydrated from the snapshot for duplicates detected before the panel
  mounted.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`d702314`](https://github.com/hedwigjs/hedwig/commit/d702314cb9a42833b87593badf2f0c5dad4fdfdc) Thanks [@pipinov](https://github.com/pipinov)! - Replay is now synchronous and ordered. `on(topic, handler, { replay })`
  delivers matching history entries to the handler before it returns,
  oldest first. Previously replay was deferred to a microtask, so a live
  message emitted in the same tick reached the handler first and the older
  entries then landed on top of it — a late-mounted view could paint a
  stale snapshot over a fresh one, or apply the same message twice. The
  history snapshot is taken on the subscriber's stack, so a message can no
  longer be delivered both live and replayed. Async handler rejections
  during replay are caught and logged (`replay.handler.failed` now carries
  `messageId` and `topic`).

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`ae5fed6`](https://github.com/hedwigjs/hedwig/commit/ae5fed678d4a4a8f05d7b37ace0be277730c5607) Thanks [@pipinov](https://github.com/pipinov)! - `initBroker()` no longer throws outside secure contexts. The session id
  baked into every message id was generated with `crypto.randomUUID()`,
  which browsers expose only on `https:` and `localhost` — on a plain
  `http://` staging or intranet host the broker failed on its first line.
  Generation now falls back to `crypto.getRandomValues()` and, as a last
  resort, `Math.random()`, still producing RFC 4122 v4 ids.
- Updated dependencies [[`09d194b`](https://github.com/hedwigjs/hedwig/commit/09d194b4a951206ca0d5d0dd634d227f75212b22), [`7b1888e`](https://github.com/hedwigjs/hedwig/commit/7b1888e95f654cb6076011c83abd6e162abf9913), [`2643013`](https://github.com/hedwigjs/hedwig/commit/2643013093319fb93332dff6e49d6c36f718bb1d)]:
  - @hedwigjs/client@0.2.0

## 0.1.1

### Patch Changes

- [`fc4bdc1`](https://github.com/hedwigjs/hedwig/commit/fc4bdc11c3738aec04fa3e473a6755b13b4fbdac) Thanks [@pipinov](https://github.com/pipinov)! - Docs-only refresh — surface the live reference stand
  ([hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)) in
  every package README, drop hardcoded version numbers, and fix minor
  accuracy issues (backend transport labels, DevTools pill name). No
  runtime changes.
