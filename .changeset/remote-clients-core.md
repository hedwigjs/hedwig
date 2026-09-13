---
"@hedwigjs/broker": minor
---

Remote clients: `broker.createRemoteClient(id, { transport, identity,
accepts, forward })` registers a participant that lives behind a
transport as a first-class client. Transports carry capability flags
(`duplex`, `fanout`, `ready`, `onClose`) and can be named by descriptor
(`{ kind: 'websocket', socket }`, `message-port`, `postmessage`, `sse`,
`broadcast-channel`); new `MessagePortTransport`. Inbound identity is
decided on this side (`fixed` | `allow` | `prefix`), `accepts` gates
injectable topics, `forward()` goes through `onSubscribe` hooks, and
drops surface as `remote.frame.rejected` / `remote.send.failed`.
`message.via` names the delivering remote. `addBridge` is unchanged in
this release and will be removed once the DevTools and demo have migrated.
