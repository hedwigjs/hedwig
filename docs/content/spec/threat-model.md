# Threat model

Status: **Informative** with normative "runtime guarantees".

The broker is an in-process bus with edges to other realms. This page
says where trust boundaries are, what the runtime enforces at those
boundaries, and what remains the application's responsibility.

## Boundaries

| Boundary | Who is on the other side | Trust decision |
| --- | --- | --- |
| Same realm (module graph) | Every module loaded on the page | None available. Any code in the realm can reach the broker; ACL hooks are accident prevention, not a sandbox. |
| `postmessage` | A document in another origin | `allowedOrigins` (inbound) and `targetOrigin` (outbound) are mandatory; the source window must be the configured target. |
| `message-port` | Whoever holds the other end | Possession of the port is the trust decision. Do not hand ports to untrusted code. |
| `broadcast-channel` | Every same-origin document | The whole origin is trusted. Use `prefix` identity so a peer cannot impersonate a local client. |
| `websocket`, `sse` | A server | Authentication and authorisation of the connection are the application's job (cookies, tokens, mTLS). The runtime only checks frame shape and identity. |
| Custom transport | Whatever the implementer wires | The transport verifies *where the bytes came from*; identity and topic policy are enforced by the remote client. |

## Runtime guarantees at ingress

For every remote client, in order, before any hook runs:

1. **Size** — frames over `maxBytes` are dropped (`TOO_LARGE`). Applies
   to string frames; structured-clone transports carry objects.
2. **Rate** — frames over `rateLimit` are dropped (`RATE_LIMITED`).
3. **Shape** — the structural check equivalent to the JSON Schema
   (`MALFORMED`); unsupported `v` / `kind` (`UNSUPPORTED`).
4. **Echo** — frames stamped with this realm's own `origin` (`ECHO`).
5. **Topic** — only topics in `accepts` may be injected
   (`TOPIC_NOT_ACCEPTED`). Default: none.
6. **Identity** — the `source` a frame may claim is decided here, never
   trusted from the wire:
   - `fixed`: the remote's id, full stop. A different claim is `SOURCE_MISMATCH`.
   - `allow`: one of the listed ids, else `SOURCE_NOT_ALLOWED`.
   - `prefix`: kept and prefixed (`tab:cart-store`), so it can never equal a local id.

Every drop is a `remote.frame.rejected { remoteId, reason }` system event
and a log line. Local and remote clients share one id namespace, so a
remote cannot register under an id a local client holds (and vice
versa, `CLIENT_ID_TAKEN`).

## What the runtime does not do

- It does not authenticate peers. A WebSocket that reached the runtime
  is assumed to be the backend the application connected to.
- It does not encrypt. Use TLS / same-origin policy.
- It does not deduplicate or persist. See *delivery-semantics*.
- It does not sandbox same-realm code. `$debug.send` is gated behind
  `initBroker({ debug: true })` as accident prevention only.

## Outbound

Only local multicasts matching a remote's `forward` patterns leave the
realm, built from the message's wire fields. Local-only flags, `ext`
received from elsewhere and `wireId` are never re-sent. `forward()` runs
`onSubscribe` hooks with the remote's id, so a policy that keeps
`analytics` away from `cart.*` keeps a remote away from it too.

## Denial of service

Per-remote `maxBytes` and `rateLimit` bound the ingress cost. A
transport that throws on `send()` is isolated per remote and reported;
it cannot fail the emitter or other remotes. Handlers run under the
broker's existing fault isolation (a throwing handler yields
`HANDLER_FAILED` for that recipient only).
