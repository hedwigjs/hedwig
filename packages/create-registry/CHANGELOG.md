# @hedwigjs/create-registry

## 0.2.0

### Minor Changes

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

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`57c12fd`](https://github.com/hedwigjs/hedwig/commit/57c12fd2d5758b8450ca30c6a4a2500f3dfc4274) Thanks [@pipinov](https://github.com/pipinov)! - Topic kinds in contracts. `TopicContract` (formerly `EventContract`, kept
  as a deprecated alias) gains `kind: 'event' | 'request' | 'state'`;
  requests declare their answer as `response`, state topics may set
  `retention: { last: 1 }`. Codegen validates the rules (a request must
  declare `response`, nothing else may), treats a missing `kind` as `event`
  with a summary warning, and emits `TopicKinds`, `EventTopic` /
  `RequestTopic` / `StateTopic`, `TopicResponses`, `TopicContracts` (the
  third parameter of `createClient<Topic, TopicPayloads, TopicContracts>`)
  and the runtime map `TOPIC_KINDS`.

## 0.1.1

### Patch Changes

- [`fc4bdc1`](https://github.com/hedwigjs/hedwig/commit/fc4bdc11c3738aec04fa3e473a6755b13b4fbdac) Thanks [@pipinov](https://github.com/pipinov)! - Docs-only refresh — surface the live reference stand
  ([hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced)) in
  every package README, drop hardcoded version numbers, and fix minor
  accuracy issues (backend transport labels, DevTools pill name). No
  runtime changes.
