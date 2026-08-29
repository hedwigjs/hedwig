# @hedwigjs/broker

Runtime broker for the Hedwig messaging toolkit. One typed API for
event and request messages across modules — in-process, cross-frame,
cross-tab, and cross-process — with hooks and observability built in.

```bash
npm install @hedwigjs/broker
```

> Pre-release. The public surface documented here is stable across
> the pre-release; anything marked *internal* may change.

**Live demo →** [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced) · **Full project docs →** [`../..#readme`](../..#readme)

---

## Table of contents

- [Quickstart](#quickstart)
- [Core concepts](#core-concepts)
- [API reference](#api-reference)
  - [Broker facade](#broker-facade)
  - [Client](#client)
  - [Broker extension surface](#broker-extension-surface)
- [Message shape](#message-shape)
- [RoutingResult](#routingresult)
- [Built-in bridges](#built-in-bridges)
- [Custom transports](#custom-transports)
- [Hooks](#hooks)
- [Message history & replay](#message-history--replay)
- [Backpressure](#backpressure)
- [System events](#system-events)
- [Inspector](#inspector)
- [Recipes](#recipes)
- [Performance](#performance)
- [TypeScript — bring your own contracts](#typescript--bring-your-own-contracts)
- [License](#license)

---

## Quickstart

Boot the broker once in the host, create a typed client per module,
subscribe and emit.

```ts
import { initBroker, createClient } from '@hedwigjs/broker';

type Topic = 'cart.item-added.v1' | 'cart.get-total.v1';
type TopicPayloads = {
  'cart.item-added.v1': { sku: string; qty: number };
  'cart.get-total.v1': void;
};

// 1. Host bootstrap — once, in the shell.
initBroker<Topic, TopicPayloads>({
  history: { enabled: true, maxSize: 200 },
});

// 2. Per-module client — typed.
const cartClient = createClient<Topic, TopicPayloads>('cart');

// 3. Fire-and-forget event.
cartClient.on('cart.item-added.v1', (msg) => {
  console.log('added', msg.data.sku, '×', msg.data.qty);
});
void cartClient.emit('cart.item-added.v1', { sku: 'CROISSANT', qty: 2 });

// 4. Typed request → response.
cartClient.on('cart.get-total.v1', () => 12.5); // handler returns
const analyticsClient = createClient<Topic, TopicPayloads>('analytics');
const result = await analyticsClient.request<'cart.get-total.v1', number>(
  'cart',
  'cart.get-total.v1',
  undefined,
);
// result.status === 'ACK', result.data === 12.5
```

Topic strings, payload shapes, and request responses are all inferred
from the two type parameters. Rename a topic in one place — TypeScript
lights up every subscriber and emitter that has drifted.

---

## Core concepts

- **Message** — one typed unit that travels through the broker: a
  `topic` + `data` payload + routing metadata (`source`, `target`,
  `id`, `timestamp`).
- **Topic** — a versioned string like `'cart.item-added.v1'`. Every
  topic maps to exactly one payload type in the `TopicPayloads` map.
- **Module (client)** — any participant in the communication graph.
  Each module obtains its own `Client` from `createClient(id)` and uses
  it for the full lifecycle of that module.
- **Broker** — the singleton runtime returned by `initBroker(config)`.
  Owns the routing plane, the hook chain, the history buffer, and the
  bridges. In-process by default; bridges extend it across contexts.
- **Bridge** — a lane that forwards matching topics to a `BridgeTransport`
  (postMessage, WebSocket, BroadcastChannel, …) and injects inbound
  traffic back into the same pipeline as `fromExternal: true`.
- **Two semantics** — `emit()` for fan-out events, `request()` for a
  targeted call awaiting a typed response. Retention and replay are an
  orthogonal mechanism layered on top of both, not a third semantic.

The broker is **contract-first**: topics and payloads are described in
TypeScript, and the runtime is a thin executor over that contract.

---

## API reference

### Broker facade

```ts
import {
  initBroker,
  getBroker,
  createClient,
  destroyBroker,
} from '@hedwigjs/broker';
```

| Function                                | Purpose                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `initBroker<T, P>(config?)`             | Boot the broker once. Idempotent — returns the existing instance if already initialized.      |
| `getBroker<T, P>()`                     | Return the current broker without holding the `initBroker` reference. Throws if not booted.   |
| `createClient<T, P>(id)`                | Return the typed `Client` for `id`. Idempotent: existing clients are reset and returned.      |
| `destroyBroker()`                       | Tear down bridges, subscriptions, history, hooks, and the client registry.                    |

`BrokerConfig`:

```ts
{
  history?: {
    enabled: boolean;
    maxSize?: number; // default 1000
    ttl?: number;     // ms, undefined = no expiration
  };
  logger?: BrokerLogger; // see "Logger" below
}
```

### Client

Returned by `createClient(id)`.

| Method                                              | Semantics                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `on(topic, handler, options?)`                      | Subscribe. Returns an unsubscribe function. Accepts `backpressure` and `replay` options. Throws if an `onSubscribe` hook rejects. |
| `off(topic)`                                        | Unsubscribe. No-op if not subscribed.                                                                                     |
| `emit(topic, data, options?)`                       | Broadcast to every subscriber of `topic`. Resolves with the aggregated `RoutingResult`.                                    |
| `request<K, R>(recipient, topic, data, options?)`   | Targeted call to one recipient. Resolves with `RoutingResult<R>` where `R` is the handler's return type.                   |
| `reset()`                                           | Drop every subscription for this client; keep it registered. Used internally for HMR / re-mount.                          |
| `destroy()`                                         | Unregister the client; the instance becomes inert.                                                                        |
| `id`                                                | The client id passed to `createClient`.                                                                                   |

Handlers receive the full immutable `Message<T, P[T]>` — the payload
lives on `msg.data`. A handler's return value is captured on
`RoutingResult.data` for `request()` callers. Sync and async handlers
are both supported.

### Broker extension surface

Returned by `initBroker()` / `getBroker()`.

| Member                                            | Kind          | Purpose                                                                                          |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `$systemEvents`                                   | push channel  | Subscribe to broker lifecycle events (clients, subscriptions, bridges, rejections).              |
| `inspect`                                         | pull snapshot | Read-only view over clients, subscriptions, bridges, history.                                    |
| `$debug.send(source, topic, target, data)`        | internal      | Inject a synthetic message through the full pipeline. Marked `synthetic: true`. For DevTools & tests. |
| `addBridge(id, { transport, forward })`           | wiring        | Register a bridge. Idempotent — an existing id is destroyed and replaced. Returns a remover.     |
| `useBeforeSendHook(fn)`                           | extension     | Gate outgoing messages. Return `{ allowed: false, message }` to reject.                          |
| `useAfterSendHook(fn)`                            | extension     | Observe delivery outcomes. Receives the frozen message + `RoutingResult`.                        |
| `useOnSubscribeHook(fn)`                          | extension     | Gate subscriptions. Return `{ allowed: false, message }` to reject.                              |
| `destroy()`                                       | lifecycle     | Full shutdown. Bridges torn down, registries cleared, subsequent calls become no-op warnings.    |

The `$` prefix marks broker-internal surfaces intended for tooling
(DevTools, tracing) — never for business code.

---

## Message shape

Every routed message has the same envelope:

```ts
interface Message<T extends string, P> {
  id: string;              // unique per message ("abc-42")
  topic: T;                // e.g. 'cart.item-added.v1'
  source: string;          // client id that emitted
  target: string;          // recipient id, or '*' for broadcast
  data: P;                 // typed payload
  timestamp: number;       // Date.now() at emit
  replayed?: boolean;      // true when delivered from the history buffer
  fromExternal?: boolean;  // true when injected by a bridge
  synthetic?: boolean;     // true when injected via broker.$debug.send
}
```

Messages are `Object.freeze()`d before entering the pipeline. Do not
mutate `msg.data`; treat handlers as pure observers.

---

## RoutingResult

Every `emit` / `request` resolves with a `RoutingResult`:

```ts
{
  status: 'ACK' | 'NACK';
  reason: RoutingReasonType;
  message: string;          // human-readable
  timestamp: number;
  recipientId?: ClientID;   // unicast (request)
  recipientIds?: ClientID[]; // multicast (emit)
  data?: TResponse;         // handler return value (request only)
}
```

`RoutingReason` values:

| Reason              | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `DELIVERED`         | Unicast delivered; handler ran to completion.                  |
| `DISPATCHED`        | Multicast dispatched to at least one subscriber.               |
| `REPLAY_DELIVERED`  | Message came from the history buffer (replay).                 |
| `HOOK_REJECTED`     | A `beforeSend` hook returned `{ allowed: false }`.             |
| `NO_SUBSCRIBERS`    | Multicast — no one is subscribed to this topic.                |
| `NOT_SUBSCRIBED`    | Unicast — target exists but has no handler for this topic.     |
| `HANDLER_FAILED`    | The handler threw; the error is logged and the promise resolves NACK. |
| `BROKER_DESTROYED`  | Emit called on a destroyed broker.                             |

The full enum is exported as `RoutingReason` for exhaustive `switch`
statements.

---

## Built-in bridges

Four transports ship inside `@hedwigjs/broker` for the common wires.
Each implements `BridgeTransport`; pair with `broker.addBridge()`.

| Transport                       | Wire                                       | Direction | Notes                                                                                             |
| ------------------------------- | ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| `PostMessageTransport`          | `window.postMessage` between window/iframe | duplex    | `allowedOrigins` allowlist is the trust boundary. Warn on `'*'` origin.                            |
| `BroadcastChannelTransport`     | `BroadcastChannel` between same-origin tabs | duplex    | Same-origin only. Sync UI state across tabs (theme, session, locale).                              |
| `WebSocketTransport`            | Wraps an externally-owned `WebSocket`      | duplex    | Connection/reconnect handled outside the transport. Serializes as JSON.                            |
| `SSETransport`                  | Wraps `EventSource`                        | inbound   | `send()` is a no-op with a warning. Browser handles reconnect. Pair a POST endpoint if you need upstream. |

```ts
import { getBroker, PostMessageTransport } from '@hedwigjs/broker';

const iframe = document.querySelector('iframe')!;
getBroker().addBridge('checkout-iframe', {
  transport: new PostMessageTransport({
    target: iframe.contentWindow!,
    allowedOrigins: ['https://checkout.example.com'],
  }),
  forward: ['cart.*', 'user.*'],
});
```

`forward` patterns support `*` glob segments. Anything not matched
stays local to the current broker instance.

---

## Custom transports

`BridgeTransport` is the extension point. Anything that satisfies its
three-method contract plugs in — WebRTC data channels, Service Worker
messaging, Electron IPC, MessageChannel to a Worker, custom protocols.

```ts
import type { BridgeTransport } from '@hedwigjs/broker';

class MyTransport implements BridgeTransport {
  #cb: ((data: unknown) => void) | null = null;

  send(data: unknown): void {
    try { myWire.publish(data); }
    catch (e) { console.error('[MyTransport] send failed:', e); }
  }

  onMessage(cb: (data: unknown) => void): () => void {
    this.#cb = cb;
    const off = myWire.subscribe((payload) => {
      // Validate source/origin/signature BEFORE forwarding.
      // The transport is the trust boundary between broker and wire.
      if (!isTrusted(payload)) return;
      this.#cb?.(payload);
    });
    return () => { off(); this.#cb = null; };
  }

  destroy(): void { this.#cb = null; myWire.close(); }
}
```

Contract summary:

- **`send(data)`** must not throw — catch wire errors and log. A failing
  wire must not break the broker pipeline.
- **`onMessage(cb)`** is called once at bridge construction. Validate
  every inbound payload (origin, signature, schema) before invoking
  `cb`. Return an unsubscribe function.
- **`destroy()`** releases sockets, listeners, timers. Must be
  idempotent.

Transports are the **trust boundary** between the broker and the
outside world. The broker will route whatever a transport hands it —
validate at the wire.

---

## Hooks

Three hooks let adapters and plugins extend the broker without
touching internals. Register on the broker, receive an unregister
function.

### `useBeforeSendHook` — gate outgoing messages

Synchronous. Runs for every emit *and* for every inbound bridge
message (use `msg.fromExternal` to distinguish). Return
`{ allowed: false, message }` to short-circuit; the emit resolves with
`NACK HOOK_REJECTED` and a `message.rejected` system event fires.

```ts
import { getBroker } from '@hedwigjs/broker';

getBroker().useBeforeSendHook((msg) => {
  if (msg.topic.startsWith('admin.') && msg.source !== 'shell') {
    return { allowed: false, message: 'admin.* is shell-only' };
  }
  return { allowed: true };
});
```

Typical uses: ACL / capability checks, schema validation, tracing
span injection, redaction.

### `useAfterSendHook` — observe outcomes

Fire-and-forget. Receives the frozen message and the final
`RoutingResult`. Exceptions are caught and logged.

```ts
getBroker().useAfterSendHook((msg, result) => {
  metrics.record(msg.topic, {
    ok: result.status === 'ACK',
    reason: result.reason,
    recipients: result.recipientIds?.length ?? (result.recipientId ? 1 : 0),
  });
});
```

Typical uses: metrics, structured logs, tracing exit, audit trail.

### `useOnSubscribeHook` — gate subscriptions

Synchronous. Called before a subscription is registered. Return
`{ allowed: false, message }` to reject — `client.on()` throws with
that message and a `subscription.rejected` system event fires.

```ts
getBroker().useOnSubscribeHook((topic, clientId) => {
  if (topic.startsWith('user.pii.') && !isTrustedClient(clientId)) {
    return { allowed: false, message: `${clientId} may not read PII` };
  }
  return { allowed: true };
});
```

Typical uses: role-based ACL on read paths, dev-time contract audits.

---

## Message history & replay

The broker keeps an in-memory ring buffer. Enable it once in
`initBroker`, opt in per-message on `emit`, and opt in per-subscription
on `on`.

```ts
initBroker({
  history: { enabled: true, maxSize: 500, ttl: 60_000 }, // 1 min TTL
});

// Producer opts a message in.
void cartClient.emit(
  'cart.snapshot.v1',
  { items, total },
  { history: true },
);

// Late subscriber replays the most recent 10 snapshots.
menuClient.on(
  'cart.snapshot.v1',
  (msg) => renderCart(msg.data),
  { replay: { limit: 10 } },
);
```

Replayed messages carry `replayed: true` — handlers can tell historical
traffic apart from live traffic. Replay is best-effort against a
bounded buffer; do not rely on it as durable storage.

**When to use.** Late-joining modules (an MFE that mounts after the
initial burst), UI resurrection (a modal that re-opens should see the
latest `state.v1` message), reconnection recovery.

**When NOT to use.** As an event log — the buffer is bounded and
in-memory. As a request/response mechanism — use `request()` for that.

---

## Backpressure

Per-subscription control over handler invocation rate. Three
strategies, mutually exclusive:

```ts
menuClient.on(
  'inventory.tick.v1',
  updateStock,
  { backpressure: { throttle: 100 } }, // ≤ 10 calls/sec
);

searchClient.on(
  'search.query.v1',
  runSearch,
  { backpressure: { debounce: 250 } }, // fire after 250 ms of quiet
);

telemetryClient.on(
  'metrics.event.v1',
  ingest,
  {
    backpressure: {
      rateLimit: { max: 1000, window: 1000 }, // ≤ 1k/sec, drop excess
      onDrop: (n) => log.warn(`dropped ${n} metrics events`),
    },
  },
);
```

| Strategy      | Behavior                                                                                     | Fit                                          |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `throttle`    | First call runs immediately; subsequent calls collapse into a trailing invocation each window. | Real-time charts, high-frequency progress    |
| `debounce`    | Every call resets a timer; only the last message runs after `debounce` ms of silence.        | Search-as-you-type, form validation          |
| `rateLimit`   | Allow `max` messages per `window` ms. Excess is dropped (lost). `onDrop` reports counts.     | Ingest protection, burst tolerance           |

The wrapper is on the hot path even when idle — bench
`07-backpressure-overhead` measures the per-call cost so you can
budget accordingly.

---

## System events

Broker-lifecycle signals published on `broker.$systemEvents`. Not
user messages — infrastructure telemetry.

| Event                    | Payload                                                    | Fired when                                                                 |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `client.registered`      | `{ clientId, at }`                                         | `createClient(id)` registers a new id.                                      |
| `client.unregistered`    | `{ clientId, at }`                                         | `client.destroy()` or broker teardown.                                      |
| `subscription.added`     | `{ clientId, topic, options? }`                            | `client.on(topic, …)` succeeds.                                             |
| `subscription.removed`   | `{ clientId, topic }`                                      | `client.off(topic)` or reset/destroy.                                       |
| `subscription.rejected`  | `{ clientId, topic, reason }`                              | An `onSubscribe` hook denied the subscription. Client also throws.          |
| `message.rejected`       | `{ source, target, topic, reason }`                        | A `beforeSend` hook denied a message. Emit also resolves `NACK HOOK_REJECTED`. |
| `bridge.added`           | `{ bridgeId }`                                             | `broker.addBridge(id, …)`.                                                  |
| `bridge.removed`         | `{ bridgeId }`                                             | Bridge remover called, or broker teardown.                                  |

```ts
const off = getBroker().$systemEvents.on('message.rejected', (evt) => {
  console.warn('blocked by ACL:', evt);
});

// Or subscribe to everything for a unified feed (DevTools style):
const offAll = getBroker().$systemEvents.onAny((event, payload) => {
  ring.push({ event, payload, at: Date.now() });
});
```

Listeners are fire-and-forget; exceptions are caught and logged, never
propagated back into the pipeline.

---

## Inspector

Point-in-time state snapshots on `broker.inspect`. Pair with
`$systemEvents` to build accurate initial state without races:
snapshot first, then subscribe.

```ts
const inspect = getBroker().inspect;

inspect.getClients();            // [{ id, connectedAt, subscriptions: [...] }, ...]
inspect.getSubscribedClientIds(); // ['cart', 'menu', ...]
inspect.getBridges();            // [{ id, forwardPatterns, transportKind }, ...]
inspect.getHistory();            // [{ message, timestamp, sequence }, ...]
inspect.getHistoryStats();       // { enabled, count, oldestTimestamp?, newestTimestamp?, memoryUsage? }
```

All array returns are `ReadonlyArray` — mutating them will not affect
broker state. This is the API `@hedwigjs/devtools` reads on the pull
path.

---

## Recipes

### Idiomatic module setup

```ts
// modules/cart/src/client.ts
import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@your-app/registry';

export const cartClient = createClient<Topic, TopicPayloads>('cart');
```

One client per module. Import it wherever the module needs to talk to
others. `createClient` is idempotent, so HMR and re-mounts are safe.

### Point-to-point request with a typed response

```ts
const result = await checkoutClient.request<'cart.get-total.v1', number>(
  'cart',
  'cart.get-total.v1',
  undefined,
);

if (result.status === 'ACK') {
  proceed(result.data); // typed as number
}
```

The recipient's handler simply returns a value:

```ts
cartClient.on('cart.get-total.v1', () => computeTotal());
```

### Late-joining subscriber gets last state

```ts
// Producer:
void cartClient.emit('cart.snapshot.v1', snapshot, { history: true });

// Late subscriber gets the most recent snapshot immediately:
cartClient.on(
  'cart.snapshot.v1',
  render,
  { replay: { limit: 1 } },
);
```

### Cross-tab sync

```ts
import { getBroker, BroadcastChannelTransport } from '@hedwigjs/broker';

getBroker().addBridge('cross-tab', {
  transport: new BroadcastChannelTransport('my-app'),
  forward: ['theme.*', 'user.session.*'],
});
```

Now any `emit` on those topics reaches every open tab of the same
origin. On the receiving side the same handler runs, with
`msg.fromExternal === true`.

### Declarative allowlist ACL

```ts
const ALLOW: Record<string, string[]> = {
  shell: ['*'],
  cart: ['cart.*'],
  menu: ['menu.*', 'cart.get-total.v1'],
};

getBroker().useBeforeSendHook((msg) => {
  const patterns = ALLOW[msg.source] ?? [];
  const ok = patterns.some((p) => matchPattern(msg.topic, p));
  return ok
    ? { allowed: true }
    : { allowed: false, message: `${msg.source} may not emit ${msg.topic}` };
});
```

Every rejection surfaces as `message.rejected` on `$systemEvents` —
route it to your audit sink for a security signal.

### Pluggable logger

```ts
initBroker({
  logger: {
    warn: (event, meta) => log.warn({ event, ...meta }),
    error: (event, meta) => Sentry.captureMessage(event, { extra: meta }),
  },
});
```

`BrokerLogEvent` is a closed union of stable string codes
(`'handler.failed'`, `'hook.failed'`, …) — safe to use as filter keys
in Sentry / Datadog / Grafana.

---

## Performance

`@hedwigjs/broker` ships a 15-scenario tinybench harness. Highlights
from the reference machine (macOS, M-series):

- `emit` throughput at 10 subscribers — millions of ops/sec.
- Dispatch cost stays constant per-subscriber as fan-out grows to
  10 000 (`04-fanout-scaling`).
- Dispatch stays O(1) across 10 000 unrelated topics
  (`08-multi-topic-isolation`).
- Backpressure wrapper adds tens of nanoseconds per call
  (`07-backpressure-overhead`).

```bash
npm run bench             # every scenario, sequentially
npm run bench:one 04      # one scenario, matched by prefix
```

Full method and scenario list: [`benchmarks/README.md`](./benchmarks/README.md).

---

## TypeScript — bring your own contracts

The broker consumes two type parameters — `Topic` (the string union)
and `TopicPayloads` (the `topic → payload` map) — from anywhere. The
runtime does not care where they come from.

```ts
// Hand-written
type Topic = 'user.login.v1' | 'cart.item-added.v1';
type TopicPayloads = {
  'user.login.v1': { userId: string };
  'cart.item-added.v1': { sku: string; qty: number };
};

// Or generated from Zod schemas, Protobuf, GraphQL codegen, OpenAPI,
// or the opinionated starter kit `@hedwigjs/create-registry`.
```

The `@hedwigjs/create-registry` CLI scaffolds a topic registry package
for TS-first greenfield projects, but nothing forces it — mix
generated and hand-written topics in one map if that suits your
codebase. See
[`../../docs/content/guides/bring-your-own-contracts.md`](../../docs/content/guides/bring-your-own-contracts.md).

---

## License

MIT.
