---
"@hedwigjs/broker": minor
"@hedwigjs/client": minor
"@hedwigjs/create-registry": minor
"@hedwigjs/devtools": minor
---

Retention is declared in the contract, not at the emit site. An event
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
