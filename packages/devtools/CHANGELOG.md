# @hedwigjs/devtools

## 0.2.0

### Minor Changes

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`40780b6`](https://github.com/hedwigjs/hedwig/commit/40780b6de6b1a62c54f13dab5990b758bc35a3ab) Thanks [@pipinov](https://github.com/pipinov)! - The panel now runs on React 18.2+ as well as React 19 (peer range
  `^18.2.0 || ^19.0.0`). The bundle used to inline `react/jsx-runtime`
  from the React installed at build time (19), so a React 18 host failed
  at first render with `Cannot read properties of null (reading
'useMemo')`; every `react/*` and `react-dom/*` request is now external
  and resolves to the host's copy. A standalone smoke project renders the
  built bundle under React 18.3 in CI to keep it that way.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`42c3432`](https://github.com/hedwigjs/hedwig/commit/42c343211654a105b69f960ebc483041f26f9e91) Thanks [@pipinov](https://github.com/pipinov)! - Remote clients in the panel: the Clients tab lists them with a
  `remote · <transport>` badge and a detail view (transport, identity mode,
  requests, `accepts`, forwarded topics; counters keyed by `via` and by
  forwarded multicasts), the Messages tab shows `via <remote>` instead of
  `external`, and the System Events tab renders `remote.created`,
  `remote.destroyed`, `remote.frame.rejected` and `remote.send.failed`.
  The Bridges tab and the `bridge.*` events are gone.

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

### Patch Changes

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

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`1b0b1f1`](https://github.com/hedwigjs/hedwig/commit/1b0b1f1e1931f9135615af4cd8e4c1db54408fe9) Thanks [@pipinov](https://github.com/pipinov)! - System Events renders the wire-level request trace (`request.forwarded`,
  `response.received` with latency, `request.timeout`, `response.sent`)
  with `sent` / `received` badges and the correlation id.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`0bddafd`](https://github.com/hedwigjs/hedwig/commit/0bddafd111f11b6a35ccec04314842065e455396) Thanks [@pipinov](https://github.com/pipinov)! - Messages show the topic's kind from the registry (`event` / `request` /
  `state`) instead of multicast / unicast when the contract declares it, a
  state topic's initial delivery carries a `retained` pill, and
  `state.retained` appears in System Events.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`3cdc91d`](https://github.com/hedwigjs/hedwig/commit/3cdc91d76bb0390ed7a1aa0330469a07ffa29a80) Thanks [@pipinov](https://github.com/pipinov)! - Message details show the delivering remote with its wire id (`Via`) and
  the frame's `ext` block, so a `traceparent` or a backend's own id can be
  read off a row.
- Updated dependencies [[`51ae14d`](https://github.com/hedwigjs/hedwig/commit/51ae14d2529ece411fb96f1b35037dc7c7b04a83), [`09d194b`](https://github.com/hedwigjs/hedwig/commit/09d194b4a951206ca0d5d0dd634d227f75212b22), [`7d54327`](https://github.com/hedwigjs/hedwig/commit/7d54327b3d99971109c3de8da1ce009485374d63), [`57315bb`](https://github.com/hedwigjs/hedwig/commit/57315bbafa259bd6c4e3f9d1646cbb23f22a1f1a), [`2134e4b`](https://github.com/hedwigjs/hedwig/commit/2134e4b59db384663c5e71c86c400584d3a6b3e2), [`3730090`](https://github.com/hedwigjs/hedwig/commit/373009014b9b657b4ecc49860faf9d119f1d8fdd), [`8b5ebfd`](https://github.com/hedwigjs/hedwig/commit/8b5ebfd1a5e0fd312641aab78e4ed2321c0c75e9), [`67b1b6b`](https://github.com/hedwigjs/hedwig/commit/67b1b6b823f13352e6bc9b97c160729b6574c332), [`1b0b1f1`](https://github.com/hedwigjs/hedwig/commit/1b0b1f1e1931f9135615af4cd8e4c1db54408fe9), [`d702314`](https://github.com/hedwigjs/hedwig/commit/d702314cb9a42833b87593badf2f0c5dad4fdfdc), [`7b1888e`](https://github.com/hedwigjs/hedwig/commit/7b1888e95f654cb6076011c83abd6e162abf9913), [`2643013`](https://github.com/hedwigjs/hedwig/commit/2643013093319fb93332dff6e49d6c36f718bb1d), [`12d5ded`](https://github.com/hedwigjs/hedwig/commit/12d5dedc952abac3a506f2b23ed9c6d607436b1d), [`ae5fed6`](https://github.com/hedwigjs/hedwig/commit/ae5fed678d4a4a8f05d7b37ace0be277730c5607), [`3cdc91d`](https://github.com/hedwigjs/hedwig/commit/3cdc91d76bb0390ed7a1aa0330469a07ffa29a80)]:
  - @hedwigjs/broker@0.2.0

## 0.1.1

### Patch Changes

- [`fc4bdc1`](https://github.com/hedwigjs/hedwig/commit/fc4bdc11c3738aec04fa3e473a6755b13b4fbdac) Thanks [@pipinov](https://github.com/pipinov)! - Docs-only refresh — surface the live reference stand
  ([hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)) in
  every package README, drop hardcoded version numbers, and fix minor
  accuracy issues (backend transport labels, DevTools pill name). No
  runtime changes.
- Updated dependencies [[`fc4bdc1`](https://github.com/hedwigjs/hedwig/commit/fc4bdc11c3738aec04fa3e473a6755b13b4fbdac)]:
  - @hedwigjs/broker@0.1.1
