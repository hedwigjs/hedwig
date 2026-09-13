# Delivery semantics across a wire

Status: **Normative** for the runtime, descriptive for transports.

What a caller may rely on when a message leaves the realm through a
remote client, and what it must not assume.

## Two verbs, two promises

| Verb | Locally | Across a wire |
| --- | --- | --- |
| `emit(topic, data)` | Multicast to every current subscriber; resolves `ACK DISPATCHED` with the recipient ids. | The same multicast is additionally handed to every remote client whose `forward` patterns match the topic. The caller's result reflects **local** delivery only; wire failures surface as `remote.send.failed`. |
| `request(target, topic, data)` | Unicast to one handler; resolves with its return value or a `NACK` reason. | When `target` is a remote client: a `kind: 'request'` frame with `correlationId` and `deadline`, answered by a `kind: 'response'` frame over the same transport. Resolves with the far side's result, `NACK TIMEOUT` locally, `NACK REMOTE_GONE` / `BROKER_DESTROYED` on teardown, `NACK TRANSPORT_ONE_WAY` / `TRANSPORT_FANOUT` immediately when the transport cannot answer. Exactly one `afterSend` fires, with `via` set. |

## At-most-once

A frame is sent at most once per remote client. A request that times out
locally may still be executed by the far side; a retry is a new request
with a new id, and idempotency is the handler's job (key on the request
id, which the responder sees as `wireId`). A request that arrived over
one wire is never relayed to another remote client: it is answered
`NOT_SUBSCRIBED` unless a local client handles it.

There is no retry, no acknowledgement and no persistence in the runtime. A transport that
throws or never becomes ready loses the frame; the loss is reported
(`remote.send.failed { reason: 'TRANSPORT_THREW' | 'NOT_OPEN' }`), never
retried. Applications that need durability implement it above the
broker (retained state re-emitted on connect, idempotent handlers keyed
by `(source, wireId)`).

## Ordering

Within one remote client, frames are handed to the transport in emit
order. Whether they arrive in that order is the transport's property:
`websocket`, `message-port`, `postmessage` and `sse` preserve order;
`broadcast-channel` preserves order per sender tab. Across different
remote clients there is no ordering guarantee.

## What is never forwarded

- A frame that came in over a wire (`fromExternal: true`) is never
  forwarded to any remote client, including the one it came from.
- A frame whose `origin` is the receiving realm's own session id is
  dropped at ingress (`ECHO`).
- Replayed history entries are local (`replayed: true`); a late
  subscriber's replay does not re-send anything on the wire.
- Synthetic messages from the debug channel are forwarded like real
  ones; the `synthetic` flag itself stays local.
- Responses are matched by `correlationId` on the remote client whose
  transport carried the request. A response over any other path, a late
  one, or a duplicate is ignored.

## Deduplication

The runtime does not deduplicate. `(source, wireId)` is stable per
producer frame; a handler that must be idempotent keys on it. The same
pair reaching two tabs through `broadcast-channel` is the intended
fan-out, not a duplicate.

## History

External frames are not recorded in the receiving realm's history buffer;
the producing realm recorded them (if it chose to). Recording them again
would duplicate on every hop.

## Hooks

`beforeSend` and `afterSend` run for external frames exactly as for
local ones, after ingress checks, with `fromExternal`, `via`, `wireId`
and `ext` set. `onSubscribe` runs for a remote client's `forward()` with
the remote's id as the subscriber.
