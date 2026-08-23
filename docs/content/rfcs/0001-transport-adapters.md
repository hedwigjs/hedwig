# RFC 0001 — Transport adapters

- **Status:** Draft
- **Created:** 2026-08-23
- **Owners:** —
- **Supersedes:** —

## Summary

Hedwig core stays transport-agnostic. Any code that turns an external event
source (WebSocket, SSE, `postMessage`, third-party SDK, Kafka bridge, …) into
typed bus events lives in a **transport adapter**. Adapters are shipped as
independent packages so users pick only what they need.

## Motivation

Real-world backends and third-party services rarely emit events in the shape
we want on the bus. If core embedded transport code, we would either:

- ship transports we don't use (bundle bloat, dependency drag), or
- force users to fork core to add a transport we don't know about.

Making the boundary an interface — `Adapter` — lets the ecosystem grow
without touching core. It also gives us one obvious place for schema
validation, envelope normalization, and error handling.

## Non-goals

- Prescribing an internal event envelope for _external_ services. Every
  adapter is allowed to interpret raw data however it wants; the contract is
  what it hands to `bus.emit`.
- Server-side bus (`@hedwigjs/node`). Rejected — see § Alternatives.

## Design

### Contract

```ts
export interface Bus {
  emit<K extends TopicName>(topic: K, payload: TopicMap[K]): void;
  on<K extends TopicName>(topic: K, handler: Handler<K>, opts?: SubscribeOptions): Disposer;
  // …
}

export interface Adapter {
  /** Called once the bus is ready. Returns a disposer for teardown. */
  connect(bus: Bus): Disposer;
}
```

Adapters that push events into the bus are **sources**. Adapters that forward
bus events outward (analytics, logging, third-party APIs) are **sinks**. Both
implement the same interface — a sink just calls `bus.on` inside `connect`
and forwards to its external target.

### Wiring

```ts
initBroker({
  adapters: [
    createWsAdapter({
      url: 'wss://api.example.com/events',
      parse: (raw) => ({ topic: 'notification.show.v1', payload: raw }),
    }),
    createSegmentSink({ writeKey: '…' }),
  ],
});
```

### Error handling

Adapters must not throw on unparseable input. On parse or validation failure
they emit a technical topic:

```ts
'_hedwig.adapter.error.v1': {
  adapter: string;      // "@hedwigjs/adapter-websocket" or user-provided id
  reason: string;
  raw?: unknown;
};
```

`@hedwigjs/devtools` subscribes to this topic and surfaces errors on a
timeline. Users can subscribe manually for logging or alerting.

Adapters MUST NOT invent a `retry` topic — retries are the adapter's
responsibility, invisible to the bus.

### First-party adapters

We ship a small set that covers 90 % of frontend use cases:

- `@hedwigjs/adapter-websocket` — WS client with backoff reconnect.
- `@hedwigjs/adapter-sse` — `EventSource` wrapper.
- `@hedwigjs/adapter-postmessage` — cross-window `postMessage` bridge for
  iframes and workers.
- `@hedwigjs/adapter-cloudevents` — parses/emits the CNCF CloudEvents envelope
  on top of any transport.

Service-specific adapters (Stripe, Segment, Pusher, Ably) live in user-land
or in a `hedwig-adapter-*` community naming convention.

## Reference use-cases in `examples/advanced/`

Two ad-hoc adapters exist today and will become one-liners once first-party
packages ship:

| Current file | Future adapter |
| --- | --- |
| `mfe/notifications/src/hooks/useNotificationsSocket.ts` | `@hedwigjs/adapter-websocket` |
| `mfe/checkout/src/App.tsx` (postMessage handler) | `@hedwigjs/adapter-postmessage` |

## Alternatives considered

### `@hedwigjs/node` — server-side bus

Rejected. Real backends run different runtimes (Node, Go, JVM, Python),
different transports (WS, SSE, MQTT, Kafka, EventBridge), and have events we
don't control. Forcing a Hedwig-shaped API on the server side either fights
the backend team or forks the ecosystem. Adapters at the edge give the same
uniformity on the frontend without owning server code.

### Envelope everywhere (CloudEvents-only)

Rejected as a mandate. Optional as an adapter (`@hedwigjs/adapter-cloudevents`).
Forcing every service to speak CloudEvents on day one is unrealistic in
enterprise.

## Open questions

- Do we want a lifecycle hook `Adapter.warmup?()` for adapters that need a
  handshake before events flow (auth, subscription negotiation)?
- Should `SubscribeOptions.replay` interact with adapters (e.g. replay only
  from a specific source)?
- Naming: `Adapter` vs `Source`/`Sink` split. Current lean: one interface,
  documentation calls out the two shapes.
