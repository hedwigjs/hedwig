# Support matrix

Status: **Descriptive**, updated with every runtime release. Latest published runtime: `@hedwigjs/broker` 0.1.1; this page tracks `main` (unreleased changes included). Wire `v: 1`.

## Built-in transports

| `kind` | Wire | `duplex` | `fanout` | `ready` | `onClose` | Encoding | Binary payloads |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `postmessage` | `window.postMessage` | yes | no | resolved | — | structured clone | yes |
| `message-port` | `MessagePort` | yes | no | resolved | — | structured clone | yes |
| `broadcast-channel` | `BroadcastChannel` | yes | **yes** | resolved | — | structured clone | yes |
| `websocket` | `WebSocket` (caller-constructed) | yes | no | on `OPEN` | on `close` | JSON string | no |
| `sse` | `EventSource` | **no** | no | resolved | — | JSON string | no |

Custom transports declare their own flags; defaults are `duplex: true`,
`fanout: false`, `ready` resolved, no `onClose`.

## Features by transport

| Feature | postmessage | message-port | broadcast-channel | websocket | sse |
| --- | --- | --- | --- | --- | --- |
| Inbound events | ✓ | ✓ | ✓ | ✓ | ✓ |
| Outbound events (`forward`) | ✓ | ✓ | ✓ | ✓ | — (inbound-only) |
| Requests to the remote (`requests: true`) | ✓ | ✓ | never (`TRANSPORT_FANOUT`) | ✓ | never (`TRANSPORT_ONE_WAY`) |
| Requests from the remote (answered over the same transport) | ✓ | ✓ | ✓ (fan-out: every tab answers) | ✓ | never (no upstream) |
| `maxBytes` | — (objects) | — | — | ✓ | ✓ |
| `rateLimit` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity `fixed` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity `allow` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity `prefix` | ✓ | ✓ | ✓ (recommended) | ✓ | ✓ |

A request to a fan-out remote is refused because it would have as many
responders as peers; a request *from* a peer on a fan-out transport is
answered by every realm that holds a handler, and the peer keeps the
first response matching its `correlationId`.

## Environments

| Environment | Runtime (`initBroker`) | Remote client transports available |
| --- | --- | --- |
| Browser document | ✓ | all five |
| Web Worker / SharedWorker | ✓ | `message-port`, `broadcast-channel`, `websocket`, `sse` |
| Node.js ≥ 18.17 | ✓ | `message-port` (Node `MessageChannel`), `websocket` with a WebSocket implementation, custom |
| Backend without Hedwig | — | Produces/consumes frames per the wire spec; `envelope-v1.schema.json` for validation |

## Wire versions

| `v` | Status | Notes |
| --- | --- | --- |
| absent | tolerated | Treated as v1; `kind` defaults from `target`. Removed in the next wire version. |
| `1` | current | This page. |

## Capabilities advertised by the runtime

`broker.capabilities` is a `Set` of stable strings: `transport.postmessage`,
`transport.message-port`, `transport.websocket`, `transport.sse`,
`transport.broadcast-channel`, `wire.v1` (this envelope) and
`remote.requests` (requests to and from remote clients). The same set is
on the SDK handle (`hasCapability(name)` in `@hedwigjs/client`). An SDK
checks these before relying on a feature; a missing entry means the
runtime predates it.
