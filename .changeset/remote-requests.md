---
"@hedwigjs/broker": minor
---

Requests across the wire. `client.request(remote.id, …)` to a remote
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
