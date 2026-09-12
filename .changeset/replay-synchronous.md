---
"@hedwigjs/broker": patch
---

Replay is now synchronous and ordered. `on(topic, handler, { replay })`
delivers matching history entries to the handler before it returns,
oldest first. Previously replay was deferred to a microtask, so a live
message emitted in the same tick reached the handler first and the older
entries then landed on top of it — a late-mounted view could paint a
stale snapshot over a fresh one, or apply the same message twice. The
history snapshot is taken on the subscriber's stack, so a message can no
longer be delivered both live and replayed. Async handler rejections
during replay are caught and logged (`replay.handler.failed` now carries
`messageId` and `topic`).
