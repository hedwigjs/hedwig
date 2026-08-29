# @hedwigjs/devtools

React DevTools panel for `@hedwigjs/broker`. Watch every message,
inspect clients and bridges, replay the history buffer, catch
hook-driven rejections, and hand-craft synthetic messages against a
running broker — all from a docked panel you mount in your own app.

```bash
# not yet published to npm — inside the Hedwig monorepo:
npm install @hedwigjs/devtools
```

Peer deps: `@hedwigjs/broker`, `react`, `react-dom` (React 19).

> Pre-release (`0.1.0`, private). The panel props documented here are
> the stable surface; anything marked *internal* may change.

**Full project docs & reference stand →** [`../..#readme`](../..#readme)

---

## Table of contents

- [Quickstart](#quickstart)
- [What the panel shows](#what-the-panel-shows)
- [Props reference](#props-reference)
- [Topics registry (bring your own)](#topics-registry-bring-your-own)
- [Messages rollup](#messages-rollup)
- [Debug tab — synthesize messages](#debug-tab--synthesize-messages)
- [Enabling in production](#enabling-in-production)
- [Recipes](#recipes)
- [How it works](#how-it-works)
- [License](#license)

---

## Quickstart

Boot the broker as usual, mount the panel anywhere in your dev UI,
pass the broker instance in.

```tsx
import { initBroker, getBroker } from '@hedwigjs/broker';
import { MessageBrokerDevTools } from '@hedwigjs/devtools';

initBroker({ history: { enabled: true, maxSize: 200 } });

function App() {
  return (
    <>
      <YourAppRoot />
      <MessageBrokerDevTools broker={getBroker()} />
    </>
  );
}
```

That's the whole integration. The panel attaches to `broker.$systemEvents`
and the extension hooks (`useBeforeSendHook` / `useAfterSendHook`) on mount,
detaches on unmount, and renders itself as a floating rail with a toggle
button. Enabled by default only when `process.env.NODE_ENV === 'development'`.

---

## What the panel shows

Six tabs, each backed by one channel of broker observability.

| Tab               | Source                                                                                            | Purpose                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Messages**      | `useBeforeSendHook` (pending) + `useAfterSendHook` (delivered / failed)                            | Live feed of every message. Topic, source, target, status, latency, delivery result, JSON payload preview.  |
| **Clients**       | `inspect.getClients()` + `subscription.*` and `client.*` system events                             | Tree of every registered client and its subscriptions, with per-subscription last-received timestamp.       |
| **Bridges**       | `inspect.getBridges()` + `bridge.*` system events                                                  | Every registered bridge — forward patterns, transport kind, approximate send / receive counters.            |
| **Replay Buffer** | `inspect.getHistory()`                                                                             | Contents of the broker's history ring. Only populated when `initBroker({ history: { enabled: true } })`.    |
| **System Events** | `$systemEvents.onAny`                                                                              | Unified log of lifecycle signals: `client.*`, `subscription.*`, `bridge.*`, plus `*.rejected` security signals. |
| **Debug**         | `broker.$debug.send`                                                                               | Compose and send a synthetic message through the full pipeline. Impersonate any source; multicast or unicast. |

Rejections from hooks surface in three places at once:

- `subscription.rejected` → System Events tab (the security channel).
- `message.rejected` → System Events tab, **and** the corresponding
  emit shows as `NACK HOOK_REJECTED` in Messages.
- Replayed and synthetic (DevTools-injected) messages are visually
  marked so you can distinguish them from live user traffic.

---

## Props reference

```ts
import type {
  MessageBrokerDevToolsProps,
  DevToolsPanelPosition,
} from '@hedwigjs/devtools';
```

| Prop              | Type                                                       | Default                                     | Purpose                                                                                          |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `broker`          | `MessageBroker` (from `@hedwigjs/broker`)                  | —                                           | Required. The broker to attach to.                                                                |
| `enabled`         | `boolean`                                                  | `process.env.NODE_ENV === 'development'`    | Master switch. When `false`, the component renders `null` and never attaches.                     |
| `registry`        | `TopicsRegistry`                                           | `undefined`                                 | Optional topic catalog for autocomplete and payload prefill in the Debug tab. See below.          |
| `maxEvents`       | `number`                                                   | `100`                                       | Ring-buffer capacity for the Messages log and System Events log.                                  |
| `defaultPosition` | `DevToolsPanelPosition` — `"top" \| "bottom" \| "left" \| "right"` | `"bottom"`                          | Initial dock side. Persisted per user in `localStorage`.                                          |
| `fabPosition`     | `DevToolsPanelPosition`                                    | `"right"`                                   | Edge for the floating toggle button (independent of the panel's dock side).                       |
| `storageKey`      | `string`                                                   | one built-in default                        | `localStorage` key for position, active tab, size, and open state.                                |
| `defaultOpen`     | `boolean`                                                  | `false`                                     | Open the panel on first mount (no saved state).                                                   |
| `toggleIcon`      | `ReactNode`                                                | built-in mascot PNG                         | Replace the FAB icon.                                                                             |
| `rollup`          | `MessagesRollupConfig \| false`                            | `{ minCount: 5, windowMs: 1000 }`           | Collapse same-topic bursts. `false` disables rollup. See "Messages rollup".                       |

`MessageBrokerDevToolsProps` and `DevToolsPanelPosition` are exported
for callers that wrap the panel.

---

## Topics registry (bring your own)

DevTools does not depend on a specific registry package. It accepts
any `Record<string, TopicContractInfo>` — one entry per topic — via the
`registry` prop.

```ts
export interface TopicContractInfo {
  name: string;                       // 'cart.item-added.v1'
  description: string;                // shown in Debug tab + hover cards
  examples?: Readonly<Record<string, unknown>>; // 'happy' key is the default fixture
  deprecatedBy?: string;              // topic that replaces this one
  observability?: boolean;            // NACK NO_SUBSCRIBERS is expected for this topic
}
```

Common producers:

- `@hedwigjs/create-registry` — the opinionated starter kit; emits an
  `EventContract`-shaped registry directly.
- **Hand-written manifests** — a `.ts` file exporting a plain object.
- **Codegen** — from Zod schemas, Protobuf, GraphQL, OpenAPI, or any
  other source. Adapt the output shape into `TopicContractInfo`.

```tsx
import { menuContracts } from '@your-app/menu-registry';
import { cartContracts } from '@your-app/cart-registry';

<MessageBrokerDevTools
  broker={getBroker()}
  registry={{ ...menuContracts, ...cartContracts }}
/>
```

When a registry is passed:

- Debug tab autocompletes topic names and prefills the payload editor
  with `examples.happy` (or the first example when `happy` is absent).
- Hover cards on the Messages tab surface the topic description and
  `deprecatedBy` warnings.
- Topics marked `observability: true` render `NACK NO_SUBSCRIBERS`
  neutrally instead of as errors.

Without a registry, all of the above degrades gracefully — the Debug
tab is still fully functional with a free-form topic input and an
empty payload.

---

## Messages rollup

High-frequency streams (SSE chunks, chatty polling, tick-based
telemetry) can drown out everything else in the log. The rollup
collapses consecutive `(topic, source)` bursts into a single
expandable row.

```tsx
<MessageBrokerDevTools
  broker={getBroker()}
  rollup={{ minCount: 5, windowMs: 1000 }} // default
/>
```

- `minCount` — minimum consecutive matching messages before folding
  kicks in. Bursts shorter than this stay flat as individual rows.
- `windowMs` — the maximum gap between adjacent messages that still
  count as one stream.

Pass `rollup={false}` for a fully flat feed (useful when you're
specifically debugging burst behaviour and want each row visible).

---

## Debug tab — synthesize messages

The Debug tab drives `broker.$debug.send`, the broker's internal
inject-with-arbitrary-source primitive. Every message it sends flows
through the **full pipeline**: hooks run, subscribers receive it, the
history buffer records it, bridges forward it. The only difference
from a normal `emit` is `synthetic: true` in the message envelope, so
DevTools can visually flag spoofed traffic.

Controls:

- **Multicast / Unicast** — picks `target: '*'` vs `target: <clientId>`.
- **Source** — dropdown of registered client ids plus a plain
  `devtools` label. Impersonation is safe: the broker does not touch
  the client registry when handling `$debug.send`.
- **Topic** — autocompleted from the registry when one is provided;
  otherwise free-form.
- **Payload** — JSON editor, prefilled from `examples.happy` when the
  registry has one.
- **Result panel** — full `RoutingResult` (status, reason, recipients,
  handler response) is shown after send.

Typical uses: reproduce a bug against a running app without leaving
DevTools, exercise the receiver side of a topic before its producer
is written, prime the history buffer for a replay test.

---

## Enabling in production

By default the panel only renders when `process.env.NODE_ENV === 'development'`.
This relies on the standard `DefinePlugin` / bundler substitution.

- **Development builds** — the panel mounts as-is.
- **Preview / staging** — pass `enabled={someEnvFlag}` to gate it on
  a feature flag or query parameter (`?debug=1`), so you can toggle
  DevTools on for QA without shipping it to end users.
- **Production** — leave `enabled` unset (or explicitly `false`). The
  component renders `null` and never attaches — the broker is not
  touched, no hooks are registered, no listeners are added.

The panel bundle itself is `sideEffects: true` because it registers
global CSS on import — treat it as a dev-only import if you want it
tree-shaken out of the production bundle:

```ts
const DevTools = process.env.NODE_ENV === 'development'
  ? (await import('@hedwigjs/devtools')).MessageBrokerDevTools
  : null;
```

---

## Recipes

### Multi-team monorepo — union the registries

```tsx
import { menuContracts } from '@your-app/menu-registry';
import { cartContracts } from '@your-app/cart-registry';
import { userContracts } from '@your-app/user-registry';

const registry = { ...menuContracts, ...cartContracts, ...userContracts };

<MessageBrokerDevTools broker={getBroker()} registry={registry} />
```

Each team keeps its own registry package. The shell composes them.

### Dedicated `/dev` route

Mount the panel with `defaultOpen` on a route only reachable in
dev/staging:

```tsx
<Route path="/dev" element={
  <MessageBrokerDevTools
    broker={getBroker()}
    enabled
    defaultOpen
    defaultPosition="right"
    storageKey="mfe-dev-panel"
  />
} />
```

### Gate by query param in preview builds

```tsx
const enabled = new URLSearchParams(location.search).has('debug');

<MessageBrokerDevTools broker={getBroker()} enabled={enabled} />
```

Ship the bundle everywhere; only `?debug=1` visitors see it.

### Custom FAB icon

```tsx
<MessageBrokerDevTools
  broker={getBroker()}
  toggleIcon={<YourLogo size={32} />}
/>
```

### Distinct panel per broker (multi-broker apps)

Nothing forces one broker per app. Pass different broker instances to
different panels with distinct `storageKey`s so each panel remembers
its own layout:

```tsx
<MessageBrokerDevTools broker={brokerA} storageKey="devtools-a" />
<MessageBrokerDevTools broker={brokerB} storageKey="devtools-b" />
```

---

## How it works

The panel is a thin React shell over the broker's stable observability
surface. On mount it calls an internal `attachInspector(broker, store)`
that wires up two channels:

- **Extension hooks (write path)** — `useBeforeSendHook` records a
  `pending` entry when a message enters the pipeline; `useAfterSendHook`
  flips it to `delivered` or `failed` and stamps the `RoutingResult`.
  This is how the Messages tab shows a message before it's dispatched
  and updates it in place with the final outcome and latency.
- **System events (lifecycle path)** — `$systemEvents.on('client.*')`,
  `$systemEvents.on('subscription.*')`, and `$systemEvents.on('bridge.*')`
  drive the Clients and Bridges tabs and populate the System Events log.
  `subscription.rejected` and `message.rejected` are surfaced separately
  as security signals.
- **Snapshots (initial hydration)** — `inspect.getClients()`,
  `inspect.getHistory()`, and `inspect.getBridges()` prime state on
  attach and refresh on each system event, so the tabs are correct
  even for bridges that were registered *before* the panel mounted.

On unmount everything unsubscribes — the broker is left exactly as it
was before the panel attached. Nothing on the broker knows or cares
that DevTools was ever mounted; the panel is purely a consumer of the
public observability surface. Anyone can build an alternative panel
(a browser-extension host, a CLI tail, a metrics collector) against
the same surface — see
[`@hedwigjs/broker` observability surface](../broker/README.md#broker-extension-surface)
for the contract.

---

## License

MIT.
