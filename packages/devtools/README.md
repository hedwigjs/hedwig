# @hedwigjs/devtools

React DevTools panel for `@hedwigjs/broker`. Watch every message,
inspect local and remote clients, replay the history buffer, catch
hook-driven rejections, and hand-craft synthetic messages against a
running broker — all from a docked panel you mount in your own app.

```bash
npm install @hedwigjs/devtools
```

Peer deps: `@hedwigjs/broker`, `react`, `react-dom` (React 19).

> Pre-release. The panel props documented here are the stable surface;
> anything marked *internal* may change.

**See it live →** click the mascot on the right edge of [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced) · **Full project docs →** [`../..#readme`](../..#readme)

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

const isDev = process.env.NODE_ENV !== 'production';

initBroker({
  history: { enabled: true, maxSize: 200 },
  debug: isDev, // arms the Debug tab's broker.$debug.send
});

function App() {
  return (
    <>
      <YourAppRoot />
      <MessageBrokerDevTools broker={getBroker()} enabled={isDev} />
    </>
  );
}
```

That's the whole integration. The panel attaches to `broker.$systemEvents`
and the extension hooks (`useBeforeSendHook` / `useAfterSendHook`) on mount,
detaches on unmount, and renders itself as a floating rail with a toggle
button.

**`enabled` is `false` by default** — pass it explicitly. The panel
cannot read your app's `NODE_ENV`: that expression would be evaluated
when this library is built, not when yours is. Keeping the code out of
production bundles is your build's job; load it lazily so it is
tree-shaken from prod chunks:

```ts
if (process.env.NODE_ENV !== 'production') {
  const { MessageBrokerDevTools } = await import('@hedwigjs/devtools');
  // … mount it
}
```

On attach the panel compares the core's `version` with the
`@hedwigjs/broker` version it was built against (same minor before 1.0,
same major after) and shows a `broker X ≠ Y` badge in the header when
they are incompatible — align `@hedwigjs/broker` and
`@hedwigjs/devtools` versions in that case.

---

## What the panel shows

Six tabs, each backed by one channel of broker observability.

| Tab               | Source                                                                                            | Purpose                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Messages**      | `useBeforeSendHook` (pending) + `useAfterSendHook` (delivered / failed)                            | Live feed of every message. Topic, source, target, status, latency, delivery result, JSON payload preview.  |
| **Clients**       | `inspect.getClients()` + `subscription.*`, `client.*` and `remote.*` system events                 | Tree of every registered client and its subscriptions. Remote clients carry a `remote · <transport>` badge; their detail shows identity mode, `accepts` and forwarded topics. |
| **Replay Buffer** | `inspect.getHistory()`                                                                             | Contents of the broker's history ring. Only populated when `initBroker({ history: { enabled: true } })`.    |
| **System Events** | `$systemEvents.onAny`                                                                              | Unified log of lifecycle signals: `client.*`, `subscription.*`, `remote.*`, plus `*.rejected` security signals, `remote.frame.rejected` edge drops and `remote.send.failed` wire failures. |
| **Debug**         | `broker.$debug.send`                                                                               | Compose and send a synthetic message through the full pipeline. Impersonate any source; multicast or unicast. Requires `initBroker({ debug: true })`; otherwise the tab explains how to arm the channel. |

Rejections from hooks surface in three places at once:

- `subscription.rejected` → System Events tab (the security channel).
- `message.rejected` → System Events tab, **and** the corresponding
  emit shows as `NACK HOOK_REJECTED` in Messages.
- `remote.frame.rejected` → System Events tab with a red `rejected` badge
  and the reason (`MALFORMED`, `ECHO`, `SOURCE_MISMATCH`, …).
- `request.forwarded` / `response.received` / `response.sent` → System
  Events tab with a blue `sent` / `received` badge, correlation id and
  latency; `request.timeout` with an amber `failed` badge. The request's
  own row in Messages carries the final result and round-trip latency.
- `remote.send.failed` → System Events tab with an amber `failed` badge
  (distinct from the red `rejected`, which is a policy decision). The
  sender's message still shows as delivered in Messages — the local
  delivery succeeded; only the wire dropped it.
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
| `enabled`         | `boolean`                                                  | `false`                                     | Master switch. When `false`, the component renders `null` and never attaches. Pass it explicitly — the library cannot see your `NODE_ENV`. |
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
history buffer records it, remote clients receive it. The only difference
from a normal `emit` is `synthetic: true` in the message envelope, so
DevTools can visually flag spoofed traffic.

The channel is **off unless the broker was booted with
`initBroker({ debug: true })`**. On a broker without it, the tab shows
a notice with the one-line fix instead of the composer, and any call
would resolve `NACK DEBUG_DISABLED`. Keep it tied to your dev flag so a
production bundle cannot inject spoofed traffic by accident.

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
  `$systemEvents.on('subscription.*')`, and `$systemEvents.on('remote.*')`
  drive the Clients tab and populate the System Events log.
  `subscription.rejected` and `message.rejected` are surfaced separately
  as security signals; `remote.frame.rejected` and `remote.send.failed`
  are log-only, since the remote client is still registered.
  `broker.duplicate_copy` (the library bundled twice in one realm) is
  hydrated from `inspect.getVersionInfo()` on attach, because it fires
  at app bootstrap before any panel exists.
- **Snapshots (initial hydration)** — `inspect.getClients()`,
  and `inspect.getHistory()` prime state on attach and refresh on each
  system event, so the tabs are correct even for remote clients that
  were registered *before* the panel mounted.

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
