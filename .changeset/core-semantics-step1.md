---
"@hedwigjs/broker": minor
"@hedwigjs/devtools": patch
---

Guard hooks now fail **closed**: a `beforeSend` or `onSubscribe` hook that
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
