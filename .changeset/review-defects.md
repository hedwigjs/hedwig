---
"@hedwigjs/broker": minor
"@hedwigjs/client": minor
"@hedwigjs/create-registry": patch
"@hedwigjs/react": patch
"@hedwigjs/vue": patch
---

Fixes from the post-0.2.0 code review.

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
