---
"@hedwigjs/client": minor
"@hedwigjs/broker": minor
---

New package `@hedwigjs/client` — the SDK a module uses: `createClient`,
`createRemoteClient`, `whenRuntimeReady`, `hasCapability`,
`getRuntimeInfo`, `RoutingReason`, and every type a module can see
(`Client`, `RemoteClient`, `Message`, `RoutingResult`, `Transport`,
`TransportDescriptor`, options). It depends on nothing at runtime: the
host's `initBroker()` registers a handle under
`Symbol.for('@hedwigjs/runtime/1')` (one symbol per ABI) and dispatches
`hedwig:runtime-ready`; the SDK locates it with two gates
(`RUNTIME_NOT_PROVIDED`, `RUNTIME_TOO_OLD` below `MIN_RUNTIME`).
`createClient()` works before the runtime exists — a lazy proxy records
subscriptions and queues emits/requests (bounded, 64; overflow →
`NACK RUNTIME_NOT_READY`) and flushes in order on registration.

Runtime: the public types now live in the SDK and are re-exported;
`createClient(id, { onConflict })` defaults to **throw** `CLIENT_ID_TAKEN`
on a duplicate id (`'reset'` restores the old HMR behaviour); a second
runtime in a realm throws `RUNTIME_ALREADY_PROVIDED`; `destroyBroker()`
removes the handle; `client.registered` and `inspect.getClients()` carry
`sdkVersion`; capabilities gain `wire.v1` and `remote.requests`. Module
Federation guidance: the host does not share `@hedwigjs/broker`.
