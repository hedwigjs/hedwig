# Wire envelope v1

Status: **Normative** · Schema: [`envelope-v1.schema.json`](../../../packages/broker/spec/envelope-v1.schema.json) · Since: `@hedwigjs/broker` 0.2

A frame is one JSON value carried by a transport between a Hedwig runtime
and a remote client. There are two shapes: a **message** (`kind: event`
or `request`) and a **response**. Everything a peer needs to interoperate
is on this page; the runtime does not embed a schema validator, it runs a
structural check equivalent to the schema.

## Message

```jsonc
{
  "v": 1,                              // wire version
  "id": "3f0c…",                       // producer-scoped id, a UUID
  "origin": "realm-7f3a",              // producing realm's session id — echo guard
  "kind": "event",                     // "event" | "request"
  "topic": "notification.show.v1",
  "source": "notifications-backend",   // claimed sender; validated by the receiver's identity mode
  "target": "*",                       // "*" or a client id
  "data": { "kind": "info", "title": "…" },
  "timestamp": 1789238807425,          // producer clock, Unix ms
  "correlationId": "r-42",             // request: own id; event: optional, groups a stream
  "deadline": 1789238812425,           // request only; absolute Unix ms
  "ext": { "traceparent": "00-…", "hedwig": { "claimedSource": "…" } }
}
```

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `v` | no¹ | `1` | Any other value is rejected as `UNSUPPORTED`. |
| `id` | no | non-empty string | A UUID, never a per-process counter. Kept on the receiving side as `wireId`. |
| `origin` | no | non-empty string | The producing realm's session id. See *Echo guard*. |
| `kind` | no¹ | `event` \| `request` | Defaults to `target === '*' ? 'event' : 'request'`. |
| `topic` | **yes** | non-empty string | |
| `source` | no | non-empty string | May be omitted for a `fixed`-identity remote; must be listed for `allow`; required for `prefix`. |
| `target` | **yes** | non-empty string | `*` for a multicast, otherwise a client id. An explicit `kind: 'request'` with `*` is `MALFORMED`. |
| `data` | **yes** | any JSON | `null` is a value; absence is `MALFORMED`. |
| `timestamp` | no | integer ≥ 0 | Producer clock; informational. |
| `correlationId` | no | non-empty string | Request: equals `id`. Event: groups the frames of one streamed result. |
| `deadline` | no | integer ≥ 0 | Request only. Absolute Unix ms after which the far side may drop it unanswered. |
| `ext` | no | object | Opaque, passed through untouched. `ext.hedwig.*` is runtime-owned; `ext.traceparent` / `ext.tracestate` are the W3C trace-context slots. |

¹ Tolerated absent for one wire version. New producers always set both.

## Response

```jsonc
{
  "v": 1,
  "id": "9b1e…",
  "origin": "realm-7f3a",
  "kind": "response",
  "correlationId": "r-42",             // the request's id
  "topic": "checkout.start.v1",
  "source": "checkout",                // the responder (the request's target)
  "target": "cart-ui",                 // the requester (the request's source)
  "status": "ACK",                     // "ACK" | "NACK"
  "reason": "DELIVERED",               // closed set, see below
  "message": "",                       // human-readable, optional
  "data": { "orderId": "A-1" },        // handler return value on ACK
  "details": { "code": 7 }             // optional structured error details on NACK
}
```

Required: `kind`, `correlationId`, `topic`, `source`, `target`, `status`,
`reason`. Responses are **flat** — no nested request, no stack traces.

`reason` is a closed enum. A producer in any language must emit one of:

| `reason` | Meaning |
| --- | --- |
| `DELIVERED` | The handler ran; `data` is its return value. |
| `HOOK_REJECTED` | A `beforeSend` hook on the responder's side denied the request. |
| `NOT_SUBSCRIBED` | No handler for `topic` at `target`. |
| `HANDLER_FAILED` | The handler threw. `message` is a summary. |
| `TIMEOUT` | The responder gave up waiting for its own handler. |
| `BROKER_DESTROYED` | The responder's runtime was shut down. |
| `SERIALIZATION_FAILED` | The handler answered, but its return value could not be encoded for the wire (`BigInt`, cycles). |

Anything else is `MALFORMED`. Reasons that are local to the requester
(the remote is gone, the transport is one-way) never appear on the wire.

## Ids and deduplication

The producer's `id` is kept on the receiving side as `wireId`; the
receiving runtime assigns its own `id` for local bookkeeping. `(source,
wireId)` is the deduplication key, the cross-realm DevTools stitching key,
and the idempotency token a backend can rely on.

## Echo guard

`origin` is the producing realm's session id — one per runtime instance
or backend process. A receiving runtime drops a frame whose `origin`
equals its own as `remote.frame.rejected { reason: 'ECHO' }`. Together
with the rule that external frames are never re-forwarded, this stops
loops through relays and mirrors. A producer that relays frames from
elsewhere must stamp its **own** `origin`, never copy one.

## Ingress order

A runtime evaluates an inbound frame in this order; the first failure
wins and is published as `remote.frame.rejected { remoteId, reason }`.
Nothing that fails here reaches a hook.

1. Size limit (`TOO_LARGE`) and rate limit (`RATE_LIMITED`), per remote client.
2. Structural check equivalent to the schema (`MALFORMED`).
3. `v` and `kind` support (`UNSUPPORTED`).
4. Echo guard (`ECHO`).
5. For messages: `topic` in the remote's `accepts` (`TOPIC_NOT_ACCEPTED`). For responses: a matching pending request by `correlationId` on **this** remote client; unmatched responses are dropped silently.
6. Identity mode (`SOURCE_MISMATCH`, `SOURCE_NOT_ALLOWED`; a missing `source` under `prefix` is `MALFORMED`).
7. Pipeline: `beforeSend` hooks, routing, `afterSend` hooks. A `kind: 'request'` is routed as a unicast to `target` and **always** answered over the same transport — the handler's result, or `NACK` with `NOT_SUBSCRIBED`, `HANDLER_FAILED`, `HOOK_REJECTED`, `SERIALIZATION_FAILED`. A request without `id` and `correlationId` is routed but cannot be answered.

## Requests

A runtime sends a local `request()` whose recipient is a remote client as
a `kind: 'request'` frame with `correlationId = id` and `deadline = now +
timeout`, and keeps a pending entry on that remote client. The response
resolves it; the runtime's own timer resolves it `NACK TIMEOUT` (the far
side may still execute — retry is the caller's decision, keyed by the
request `id`). Destroying the remote resolves pending requests `NACK
REMOTE_GONE`; destroying the runtime, `NACK BROKER_DESTROYED`. A remote
whose transport cannot answer refuses immediately: `TRANSPORT_ONE_WAY`
(inbound-only) or `TRANSPORT_FANOUT` (one `send` reaches many peers).
Those reasons are local and never appear in a response frame.

## Local-only fields

`replayed`, `fromExternal`, `synthetic`, `via`, `wireId` and `ext` on the
runtime's `Message` never go on the wire. Outbound frames are built from
the message (`v`, `id`, `origin`, `kind`, `topic`, `source`, `target`,
`data`, `timestamp`), not by serialising the internal object.

## Evolution

- Unknown top-level fields are ignored (`additionalProperties: true`).
- Unknown `kind`, or `v` greater than supported, is rejected (`UNSUPPORTED`).
- Reserved for a later revision: `kind: 'cancel'` (with the request's
  `correlationId`); `correlationId` on `kind: 'event'` is already legal and
  means "part of one streamed result".
- Encoding is JSON. Binary payloads are legal only over structured-clone
  transports (`postmessage`, `message-port`, `broadcast-channel`).
