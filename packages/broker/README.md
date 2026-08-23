# @hedwigjs/broker

Runtime broker for the Hedwig messaging toolkit. One API over any transport.

Part of the Hedwig core: `@hedwigjs/broker` (this — runtime) +
`@hedwigjs/devtools` (observability panel) + `@hedwigjs/adapter-*`
(first-party transport adapters, upcoming).

Broker consumes `Topic` + `TopicPayloads` TypeScript types from any source:
Zod, Protobuf, GraphQL codegen, hand-written `TopicMap`, or the opinionated
starter kit `@hedwigjs/create-registry`. See
[Bring your own contracts](../../docs/content/guides/bring-your-own-contracts.md).

> Pre-release. API is being stabilized. Package is not yet published to npm.

## Install

Not published yet. Inside the Hedwig monorepo the package is consumed via npm
workspaces (`"@hedwigjs/broker": "*"`).

## Overview

Frontend messaging is fragmented across `postMessage`, `WebSocket`, `SSE`,
`BroadcastChannel`, `EventTarget`, and custom event systems — each with its
own API, lifecycle, and error handling. Once events start flowing, the flow
itself is invisible to existing devtools.

`@hedwigjs/broker` unifies these transports behind one contract-first API
and exposes the observability primitives (`$systemEvents`, `inspect`)
that DevTools, tracing, and metrics tools can consume.

The broker is contract-first pub/sub:

- **Host** boots the broker once via `initBroker(config)`.
- **Each context** (microfrontend, worker, tab) obtains a typed client via
  `createClient(id)`.
- **Clients** subscribe (`on`), emit multicast (`emit`), send point-to-point
  (`request`), and clean up (`off`, `reset`, `destroy`).
- **Tooling** (DevTools, tracing) reaches broker internals via
  `$systemEvents` and `inspect` — a stable observability surface.
- **Adapters** extend behaviour (`beforeSend`, `afterSend`, `onSubscribe`
  hooks) without touching the core.
- **Bridges** carry messages across contexts (`postMessage`,
  `BroadcastChannel`, `WebSocket`, or any custom `BridgeTransport`).

## Minimal example

```ts
import { initBroker, createClient } from '@hedwigjs/broker';

type Topics = 'user.login.v1';
type Payloads = {
  'user.login.v1': { userId: string };
};

initBroker({ history: { enabled: true, maxSize: 100 } });

const client = createClient<Topics, Payloads>('shell');

client.on('user.login.v1', (message) => {
  console.log('logged in:', message.data.userId);
});

void client.emit('user.login.v1', { userId: 'u-42' });
```

## Scripts

- `npm run build` — bundle to `dist/` (ESM + CJS + `.d.ts`) via **tsup**.
- `npm test` — Jest suite.
- `npm run test:coverage` — coverage report.
- `npm run typecheck` — type-check without emit.
- `npm run format` — Prettier on `src/`.

Benchmarks from the hse origin are archived under `benchmarks-legacy/`; they
will be rewritten against the public API before returning to `benchmarks/`.

## What's inside

```
src/
├── core/
│   ├── BrokerCore.ts        # engine, implements MessageBroker contract
│   ├── MessageBroker.ts     # public interface returned by initBroker
│   ├── client/              # BrokerClient + Client contract
│   ├── routing/             # Router, Subscriptions, RoutingResult
│   ├── hooks/               # HooksRegistry (beforeSend/afterSend/onSubscribe)
│   ├── bridge/              # Bridge — carries messages across contexts
│   ├── backpressure/        # Debounce / Throttle / RateLimit strategies
│   ├── history/             # MessageHistory + SubscriptionReplay
│   ├── events/              # SystemEvents ($systemEvents channel)
│   ├── observability/       # Inspector (pull snapshots)
│   ├── logger/              # BrokerLogger contract + default impl
│   └── utils/               # deepFreeze, matchPattern
└── transports/
    ├── PostMessageTransport.ts
    ├── BroadcastChannelTransport.ts
    └── WebSocketTransport.ts
```

Transports are shipped with the package but not exported. Framework
integrations (React/Vue/etc.) and adapters are expected to compose them
via `broker.addBridge(id, { transport, forward })`.

## License

MIT.
