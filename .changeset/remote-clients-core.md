---
"@hedwigjs/broker": minor
---

Remote clients replace bridges. `broker.createRemoteClient(id, { transport,
identity, accepts, forward })` registers a participant that lives behind a
transport as a first-class client: the same id namespace, the same
`onSubscribe` / `beforeSend` hooks, listed by `inspect.getClients()` with a
`remote` block. Built-in transports are named by descriptor
(`{ kind: 'websocket', socket }`, `message-port`, `postmessage` with
mandatory `allowedOrigins` + `targetOrigin`, `sse`, `broadcast-channel`)
and instantiated by the runtime; custom ones implement the `Transport`
interface (`send` / `onMessage` / `destroy` plus optional `duplex`,
`fanout`, `ready`, `onClose`). Inbound identity is decided on this side
(`fixed` | `allow` | `prefix`), `accepts` gates injectable topics, and
every drop surfaces as `remote.frame.rejected`; a transport that throws or
never opens yields `remote.send.failed` instead of rejecting the emitter.
`message.via` names the delivering remote.

Removed: `addBridge`, `BridgeConfig`, `BridgeTransport`, `BridgeInfo`,
`inspect.getBridges()`, the `bridge.*` system events and log codes, and
the exported transport classes. `WebSocketTransport.destroy()` now closes
a still-open socket, since the remote client owns its transport.
