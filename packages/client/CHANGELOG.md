# @hedwigjs/client

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
