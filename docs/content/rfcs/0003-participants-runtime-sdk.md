# RFC 0003 — Participants, runtime/SDK split, links and the wire

- **Status:** Draft
- **Created:** 2026-09-13
- **Owners:** —
- **Supersedes:** [RFC 0001 — Transport adapters](./0001-transport-adapters.md)

## Summary

Three changes that together replace the current "bridge" model:

1. **Every participant is a client.** A client is either *local* (the
   participant's code runs in this realm) or *remote* (the participant
   runs on the far side of a transport and is represented here by a
   proxy). The proxy works in both directions: deliveries to the remote's
   own subscriptions become outbound frames, and inbound frames become
   messages emitted under the remote's id — which local clients receive
   with their own handlers, exactly as if a local client had emitted. A
   remote client has one fixed identity: whatever arrives over its
   transport carries the client's id as `source`, whatever the frame
   claims. Requests to a remote client are ordinary unicasts.
2. **The library splits into a runtime and an SDK.** The host installs
   `@hedwigjs/broker` (runtime) once and registers a handle on
   `globalThis`. Modules install `@hedwigjs/client` (SDK): types plus a
   locator, no core, no transports, no state. Modules on different SDK
   versions coexist against one runtime and migrate on their own schedule.
3. **Realm-to-realm replication is a separate thing, a *link*.** A link
   carries many foreign identities (another tab, a worker with its own
   broker), forwards events only, never requests, and applies a source
   policy. It is the one case that a remote client cannot express.

Everything beyond a transport — a backend, an iframe form — depends on a
published wire specification and JSON Schema, not on a package.

## Motivation

The current design has one abstraction, `addBridge(id, { transport,
forward })`, for every cross-context case. Verified findings against
`packages/broker/src` (2026-09-12):

- **Identity is not modelled.** `Bridge.#parseMessage` validates only that
  `topic` is a string; `source` is taken from the wire verbatim and the
  demo ACL keys on it. Any peer can impersonate any client.
- **Requests cannot cross a transport.** A unicast to an unregistered
  recipient resolves `NACK NOT_SUBSCRIBED` locally, is still forwarded,
  executes on the remote side, and the result is discarded
  (`Bridge.ts:95`). If the recipient exists on both sides it executes
  twice.
- **Two-step API for the common case.** A module that owns an iframe or a
  streaming response writes `createClient()` for itself *and*
  `getBroker().addBridge()` for the wire, then must remember to remove
  the bridge on unmount. The demo's `ai-chat` and `checkout` do exactly
  this.
- **"One broker" depends on the consumer's bundler.** The singleton was a
  module-level variable; a Module Federation remote without
  `singleton: true`, two bundlers on one page, or an ESM + CJS duplicate
  each got their own bus, silently.
- **Version drift across modules has no story.** Microfrontends deploy
  independently; a shell cannot make every module upgrade the library on
  the same day, yet every module today bundles the whole core.
- **Backends hand-craft the envelope.** `examples/advanced/backend`
  defines the message shape three times, in three files, by convention.

The first version of this library modelled transports *as clients*. The
split into clients and bridges happened because one wire can carry many
participants (another tab). That was a real constraint, but it threw
away the modelling of single-identity remotes along with it. This RFC
restores it and names the multi-identity case separately.

## Non-goals

- A server-side broker. Backends implement the wire spec in any language;
  no `@hedwigjs/node` (unchanged from RFC 0001).
- Security boundaries inside one realm. One realm is one trust zone; the
  boundary is the origin (iframe, worker, socket). See the threat-model
  spec.
- Discovery / handshake for remote participants. The host declares
  remote clients; remotes do not announce themselves.
- Multi-hop relaying (tab → shell → backend). A frame that arrived over a
  transport is never forwarded to another transport.
- Per-transport npm packages. Transports stay in the runtime.

## Terminology

| Term | Meaning |
| --- | --- |
| **Realm** | One JavaScript global: a window, an iframe, a worker. One runtime per realm. |
| **Runtime** | `@hedwigjs/broker`. Core, transports, `initBroker`, tooling surface. Installed by the host. |
| **SDK** | `@hedwigjs/client`. Types plus a locator. Installed by modules. |
| **Handle** | The object the runtime registers on `globalThis`; the only contract between runtime and SDK. |
| **Participant / client** | Anything with an id that sends or receives messages. Local or remote. |
| **Local client** | The participant's code runs in this realm. `createClient(id)`. |
| **Remote client** | The participant runs beyond a transport; locally a proxy with one identity. Its own subscriptions (`forward`) are served by sending frames out; frames it sends in are routed to local subscribers as messages from its id. `createRemoteClient(id, { transport, … })`. |
| **Link** | A connection between two brokers carrying many foreign identities. Events only. |
| **Transport** | A duplex (or inbound-only) pipe: `send` / `onMessage` / `destroy`. Built-in or custom. |
| **Wire** | The JSON frame format that crosses a transport. Specified, versioned, schema-validated. |

## Design

### 1. Packages

```
@hedwigjs/broker   runtime  — host only.  core, routing, history, backpressure,
                              transports, links, initBroker, inspect,
                              $systemEvents, hooks, $debug, DevTools surface.
@hedwigjs/client   SDK      — modules.    createClient, createRemoteClient,
                              hasCapability, getRuntimeInfo, whenRuntimeReady,
                              and every type a module can see.
@hedwigjs/devtools           — host only. Attaches to the runtime as today.
@hedwigjs/create-registry    — dev tool.  Unchanged.
```

Dependency direction: the runtime depends on the SDK for types and
re-exports them for host authors. The SDK depends on nothing and has no
peer dependency on the runtime — it requires "a runtime providing ABI 1",
checked at runtime.

Module Federation guidance changes: the host does **not** share
`@hedwigjs/broker` at all (it is private to the host), and modules do not
list it. The SDK may be bundled by every module; duplicates are
harmless because the SDK holds no state. Nothing about "one broker"
depends on bundler configuration any more.

`initBroker()` in a realm that already has a handle throws
`RUNTIME_ALREADY_PROVIDED`. A second runtime is a configuration error,
never a second bus. Module templates add an ESLint `no-restricted-imports`
rule for `@hedwigjs/broker`.

### 2. The handle

```ts
// @hedwigjs/client — handle.ts
export const RUNTIME_KEY: unique symbol = Symbol.for('@hedwigjs/runtime');
export const ABI = 1;

export interface RuntimeHandle {
  readonly abi: readonly number[];            // ABIs this runtime serves, e.g. [1]
  readonly runtimeVersion: string;            // npm version, informational
  readonly capabilities: ReadonlySet<string>; // feature detection, see §4, §7
  createClient(id: string, meta: ClientMeta): Client<any, any>;
  createRemoteClient(id: string, options: RemoteClientOptions, meta: ClientMeta): RemoteClient;
}

export interface ClientMeta {
  sdkVersion: string;  // version of @hedwigjs/client making the call
  abi: number;         // ABI the SDK was built against
}
```

The runtime registers the handle from `initBroker()` with
`Object.defineProperty(globalThis, RUNTIME_KEY, { value, enumerable: false,
writable: false, configurable: true })` and dispatches
`hedwig:runtime-ready` on `globalThis` (an `EventTarget` in windows and
workers). `destroyBroker()` removes it. Registration is lazy — inside
`initBroker`, never at import time — so `sideEffects: false` stays true.

**Evolution rules.**

- Within one ABI number the handle only grows. Methods are never removed
  or change meaning. New behaviour is announced through `capabilities`.
- SDK code feature-detects (`hasCapability('request.timeout')`) instead of
  comparing versions.
- If the contract must break, the runtime serves both: `abi: [1, 2]` with
  both surfaces, for a deprecation window. Modules on SDK 1 keep working;
  DevTools shows which client uses which ABI, so the host knows when
  serving 1 can stop. This is what makes asynchronous migration possible.

**SDK errors.** All carry a `code` and an actionable message. None create
anything.

| Code | When |
| --- | --- |
| `RUNTIME_NOT_PROVIDED` | No handle. "Call `initBroker` in the host before mounting modules, or await `whenRuntimeReady()`." |
| `ABI_UNSUPPORTED` | `handle.abi` does not include the SDK's `ABI`. |
| `TRANSPORT_UNSUPPORTED` | Descriptor `kind` not in `capabilities`. |
| `TRANSPORT_FANOUT` | A fan-out transport passed to `createRemoteClient`. |

**Why `Symbol.for` and not a module variable.** Two copies of the SDK,
or the SDK and the runtime built by different bundlers, share the global
symbol registry but not module identity. The slot is hygiene, not
security: anything in the realm could already reach the broker through
the module graph.

### 3. Participants

Two interfaces, because a single one would carry methods that are
meaningless for one of the kinds. On a remote client, `emit` is something
the far side does (it shows up here as an inbound frame), and `on(topic,
handler)` has no local handler to attach — the remote's subscription is
served by sending it frames, which is what `forward(pattern)` declares.
Local clients that want to *receive* what the remote sends subscribe as
usual with `on()`; those handlers are theirs, not the remote's.

```ts
// Local — unchanged from today, minus any bridge API.
interface Client<T extends string, P extends Record<T, any>> {
  readonly id: string;
  on<K extends T>(topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): () => void;
  off<K extends T>(topic: K): void;
  emit<K extends T>(topic: K, data: P[K], options?: MessageOptions): Promise<RoutingResult>;
  request<K extends T, R = unknown>(to: string, topic: K, data: P[K], options?: RequestOptions): Promise<RoutingResult<R>>;
  reset(): void;
  destroy(): void;   // also destroys every remote client whose owner is this client
}

// Remote — handlers behind a transport.
interface RemoteClient {
  readonly id: string;
  readonly kind: string;          // 'websocket' | 'sse' | 'postmessage' | 'message-port' | 'custom'
  readonly duplex: boolean;
  readonly pending: number;       // requests in flight to this remote (§7)
  forward(pattern: string | string[]): () => void;  // topics delivered to the remote — its subscriptions
  accept(pattern: string | string[]): () => void;   // topics it may inject — extends `accepts`
  destroy(): void;                // closes the transport, fails pending requests with REMOTE_GONE
}

interface RemoteClientOptions {
  transport: TransportDescriptor | Transport;
  accepts?: string[];             // default: nothing is accepted
  forward?: string[];             // initial subscriptions
  owner?: Client<any, any>;       // lifecycle bound to a local client
  timeout?: number;               // default for requests to this remote (§7)
  maxBytes?: number;              // string frames only (WebSocket, SSE)
  rateLimit?: { max: number; window: number };
}
```

**Creation.** `createClient(id)` returns a `Client`; `createRemoteClient(id,
options)` returns a `RemoteClient`. Both are idempotent per id: re-creating
resets subscriptions (and, for remotes, re-attaches the transport), which
keeps HMR and reconnect logic trivial. Both go through the handle and are
registered in the same client registry; both appear in the DevTools
Clients tab.

**Identity binding.** Frames arriving over a remote client's transport are
injected with `source = remote.id`, unconditionally. A backend that writes
`source: 'menu'` into its frames still shows up as `notifications-backend`.
The frame's own `source` is kept in the message for diagnostics only
(`ext.claimedSource`, see §6).

**Ownership.** `owner` ties the remote's lifecycle to a local client:
`owner.destroy()` and `owner.reset()` destroy the remote. This is how a
module that mounts an iframe or opens a stream stops leaking wires on
unmount. Remotes created by the host have no owner and live until
destroyed or until `destroyBroker()`.

**Who creates what.** The rule is lifecycle ownership. The host creates
remotes that many modules consume and that live as long as the page (the
backend notifications socket). A module creates remotes that exist for
its own sake (its iframe, its streaming reply, its worker).

### 4. Transports

```ts
// @hedwigjs/client — types/transport.ts
interface Transport {
  send(frame: unknown): void;                        // must not throw; runtime isolates it anyway
  onMessage(cb: (frame: unknown) => void): () => void;
  destroy(): void;                                   // idempotent
  readonly duplex?: boolean;                         // default true; SSE is false
  readonly fanout?: boolean;                         // default false; BroadcastChannel is true
  onClose?(cb: () => void): () => void;              // optional: lets the runtime fail pending requests early
}

type TransportDescriptor =
  | { kind: 'postmessage';  target: Window;      allowedOrigins: string[] }
  | { kind: 'message-port'; port: MessagePort }
  | { kind: 'websocket';    socket: WebSocket }
  | { kind: 'sse';          url: string;         withCredentials?: boolean; eventName?: string };
```

Built-in implementations stay in the runtime and are updated with it. A
module never imports them; it passes a descriptor and the runtime
instantiates its own class. A custom transport is an object implementing
`Transport`; after creation the runtime treats both identically. The
runtime lists what it provides in `capabilities`:
`transport.postmessage`, `transport.message-port`, `transport.websocket`,
`transport.sse`, and `link.broadcast-channel`.

Changes to the built-ins:

- `postmessage`: `allowedOrigins` becomes mandatory. The `'*'` default is
  removed; inbound frames from other origins are dropped with
  `remote.frame.rejected { reason: 'ORIGIN' }`.
- `message-port`: new. `MessagePort` from a `Worker`, `SharedWorker` or
  `MessageChannel`. No origin concept — possession of the port is the
  trust.
- `broadcast-channel`: no longer usable for a remote client (fan-out);
  link only.
- All transports log through the runtime's `BrokerLogger`, not
  `console`.

Connection management stays outside the transport, as today: the
application opens the socket, the transport wraps it. On reconnect the
owner calls `createRemoteClient` again with the new socket.

### 5. Links

```ts
// runtime only (host API); may be exposed to modules later via a capability
broker.addLink(id: string, options: {
  transport: TransportDescriptor | Transport;   // any topology, including fan-out
  forward: string[];                            // local events replicated to the peer
  accepts?: string[];                           // foreign events admitted, default: same as forward
  sources: { allow: string[] } | { prefix: string };  // mandatory source policy
}): void;
broker.removeLink(id: string): void;
```

Semantics, deliberately narrow:

- Events only. A request whose recipient is not local is never sent over a
  link; a `kind: 'request'` frame arriving over a link is dropped with
  `link.frame.rejected { reason: 'REQUESTS_NOT_ALLOWED' }`.
- Foreign `source` is either allow-listed or prefixed (`tab:cart-store`).
  With a prefix, sender exclusion no longer accidentally hides the peer's
  twin from the local twin — the behaviour the demo relies on today
  becomes an explicit choice of the consumer.
- No history recording, no echo (a frame from a link is never forwarded
  to any transport), no acknowledgement.
- Fan-out consequences are documented: "last write wins" replication.

The demo's cross-tab cart sync becomes a link with `forward:
['cart.snapshot.v1']` and `sources: { prefix: 'tab' }` — and the view
layer subscribes to `cart.snapshot.v1` regardless of source, exactly as
today, minus the accident.

### 6. The wire

The wire is a specification, `docs/content/spec/envelope-v1.md`, with a
JSON Schema, `envelope-v1.schema.json`, published as a file inside the
runtime package. No npm package is required to produce frames; the demo
backend keeps building plain objects, validated against the schema in its
tests.

```jsonc
{
  "v": 1,                          // wire version
  "id": "srv-7f3a…",               // producer-scoped; the receiving runtime assigns its own local id
  "kind": "event",                 // "event" | "request" | "response"
  "topic": "notification.show.v1",
  "source": "notifications-backend",   // advisory for remote clients (overridden), policy-checked for links
  "target": "*",                   // "*" or a client id
  "data": { … },
  "timestamp": 1789238807425,
  "correlationId": "…",            // request: own id; response: the request's id
  "ext": { … }                     // opaque: trace context, tenant, … passed through untouched
}
```

Rules:

- Local-only flags (`replayed`, `fromExternal`, `synthetic`, `via`) never
  go on the wire. Outbound frames are built from the message, not by
  serialising the internal object.
- Missing `v` and `kind` are tolerated for one version: `kind` defaults to
  `target === '*' ? 'event' : 'request'`. New producers set both.
- `response` frames carry `correlationId`, `topic` (the request's) and a
  `result: { status, reason, message, data? }` in `data`.
- Ingress order for a remote client: size limit → rate limit → schema →
  `accepts` → identity binding → pipeline. Each rejection is a
  `remote.frame.rejected { remoteId, reason }` system event and a log
  line; the frame never reaches a hook.
- `ext` is passed through by every runtime stage and every transport; the
  broker never interprets it. `ext.claimedSource` is where a remote
  client's runtime stores the `source` the frame originally claimed.

### 7. Pipeline changes

**Inbound (remote client).** Transport → ingress checks (§6) →
`Message` with `source = remote.id`, `via = remote.id`, fresh local `id`
→ `beforeSend` hooks → routing → `afterSend`. Not recorded to history, not
forwarded to any transport.

**Outbound.** After local delivery and `afterSend`, for every remote
client whose `forward` matches the topic: build the wire frame, call
`transport.send`, isolated per remote (`remote.send.failed { remoteId,
topic, messageId, error }`, the others still receive). Links are
processed the same way with their own event names. A message that
arrived over a transport is never sent to any transport.

**Request to a remote client.** `local.request(remote.id, topic, data)`:

1. Recipient resolution is by the client registry. A remote client *is*
   registered, so the request is a unicast to it — no local `NOT_SUBSCRIBED`
   dance, no double execution.
2. `remote.duplex === false` → `NACK TRANSPORT_ONE_WAY` immediately.
3. Otherwise a `kind: 'request'` frame with `correlationId = id` is sent;
   a pending entry `{ correlationId, timer }` is kept **on the remote
   client** (never global). Default timeout comes from
   `RemoteClientOptions.timeout` (5000 ms), overridable per call.
4. A `kind: 'response'` frame with a matching `correlationId` arriving
   **over that remote's transport** resolves the pending entry with the
   embedded `RoutingResult`; responses over any other path are ignored.
5. Timeout → `NACK TIMEOUT`; `remote.destroy()` (including via owner)
   → `NACK REMOTE_GONE` for every pending entry; `destroyBroker()` →
   `NACK BROKER_DESTROYED`.
6. Exactly one `afterSend` fires for the request, with the final result and
   `via = remote.id`. Wire-level trace goes to `$systemEvents`:
   `request.forwarded`, `response.received { latencyMs }`,
   `request.timeout`.

**Request from a remote client.** A `kind: 'request'` frame targets a
local client; it is routed as a unicast; the result is wrapped in a
`response` frame and sent back over the same transport. Handler errors
are serialised as `{ reason, message }` only — never stack traces or the
error object.

**Local requests** are unchanged (in-process await of the handler's
return value); `timeout` becomes available to them too, default off.

### 8. Policy

- `onSubscribe` hooks run for `remote.forward(pattern)` with the remote's
  id, exactly as for local `on()`. An ACL that says "`analytics` may not
  subscribe to `cart.*`" needs no separate rule set for remotes.
- `beforeSend` hooks see `message.via` (the remote or link id) and a
  `source` that the runtime, not the peer, assigned. Policies may key on
  either.
- `$debug.send` requires `initBroker({ debug: true })` (already landed).
- Guard hooks fail closed by default (`hooks.failMode: 'closed'`).

### 9. DevTools

- **Clients** tab lists local and remote clients. Remote rows show a
  `remote` badge, transport `kind`, `duplex`, pending requests, and the
  owner. Every row shows `sdkVersion` and `abi` from `ClientMeta` — the
  migration map for the host.
- **Bridges** tab becomes **Links**.
- Messages from a remote show `via <id>` instead of the generic
  `external` pill; request/response pairs are stitched by `correlationId`
  with latency.
- New system events rendered: `remote.frame.rejected`, `remote.send.failed`,
  `remote.gone`, `link.frame.rejected`, `link.send.failed`,
  `request.forwarded`, `response.received`, `request.timeout`.
- Handshake: the panel compares `runtimeVersion` with the runtime version
  it was built against under the semver rule (pre-1.0: same minor) and
  shows a header badge on mismatch.

### 10. Versioning and compatibility

- Runtime and SDK follow semver independently. The runtime may move fast;
  only the host updates it.
- `ABI` is an integer inside the handle, changed only when the handle
  contract breaks — expected to be rare. There is no separate "protocol
  version"; the previously introduced `PROTOCOL_VERSION` is removed.
- Compatibility for a module is "my SDK's `ABI` is in `handle.abi`". The
  runtime keeps serving old ABIs during a deprecation window it controls.
- The wire has its own `v`; the runtime accepts `v: 1` and tolerates
  missing `v` for one version.

### 11. Migration of existing code

| Today | After |
| --- | --- |
| `import { createClient } from '@hedwigjs/broker'` in a module | `from '@hedwigjs/client'` |
| `getBroker().addBridge('ai-backend-stream', { transport: new SSETransport({ url }), forward })` | `createRemoteClient('ai-backend', { transport: { kind: 'sse', url }, accepts: ['chat.reply-*'], owner: aiChat })` |
| `getBroker().addBridge('checkout-iframe', { transport: new PostMessageTransport({ target, origin }), forward })` | `createRemoteClient('checkout-iframe', { transport: { kind: 'postmessage', target, allowedOrigins: [ORIGIN] }, accepts: ['checkout.completed.v1'], owner: checkout })` |
| shell: `addBridge('backend-notifications', { transport: new WebSocketTransport(socket), forward: ['notification.show.v1'] })` | shell: `createRemoteClient('notifications-backend', { transport: { kind: 'websocket', socket }, accepts: ['notification.show.v1'] })` |
| shell: `addBridge('cross-tab-cart', { transport: new BroadcastChannelTransport(name), forward: ['cart.snapshot.v1'] })` | shell: `addLink('cross-tab-cart', { transport: { kind: 'broadcast-channel', name }, forward: ['cart.snapshot.v1'], sources: { prefix: 'tab' } })` |
| ACL: separate entries for "fictitious" sources | ACL: the same client rules; remote ids are real clients |
| backend: three local `Envelope` types | backend: one type derived from the schema, frames validated in tests; `postMessage` in the iframe targets the parent origin, not `'*'` |

`addBridge` and the exported transport classes are removed from the
public surface (pre-release; changeset `minor`).

### 12. Implementation plan

Lockstep with DevTools in every step; one changeset per step; nothing is
pushed until the sequence is reviewed.

| Step | Scope | Size |
| --- | --- | --- |
| A | Remove `PROTOCOL_VERSION`; incompatible copy → error; DevTools compares package versions | S |
| B | Core hygiene: strategies await handlers, fail-closed hooks, log meta, transports via logger, unicast bypasses backpressure, `timeout` on request, deprecate history on request | S–M |
| C | This RFC | S |
| D | `@hedwigjs/client` package, handle in the runtime, demo modules on the SDK, `sdkVersion` in DevTools | M |
| E | Envelope v1 + `docs/content/spec/*` (envelope, schema, threat model, support matrix, delivery semantics); backend validated by schema | M |
| F | Remote clients (§3, §4, §6 ingress, §7 inbound/outbound); `message-port`; demo's three bridges become remote clients | L |
| G | Links (§5); cross-tab demo; Bridges → Links; `addBridge` removed | M |
| H | Requests to/from remote clients (§7); DevTools pairing | L |

Steps I–L (topic classes in contracts, React/Vue adapters on the SDK,
transport conformance kit and e2e, CI) follow and are tracked outside this
RFC.

## Alternatives considered

**Keep one `Client` interface with optional transport.** Rejected: half
the methods would be meaningless for one kind, and the type system could
not say which.

**Per-transport npm packages** (`@hedwigjs/transport-*`, the RFC 0001
direction). Rejected: the reason was to keep transport code out of module
bundles; with the SDK split, modules contain no transport code by
construction. A single `@hedwigjs/transports` package may appear later
only if the wire code is wanted outside a Hedwig runtime.

**A hand-maintained `PROTOCOL_VERSION` keying the singleton slot.**
Implemented briefly, then rejected: a second versioning axis that
duplicated semver and whose "different version → separate broker"
consequence violated the one-broker invariant. Replaced by the handle's
`abi` plus fail-fast.

**A Node SDK for backends** (`@hedwigjs/wire`). Deferred: the wire is a
spec; a schema file is enough for one demo backend. Add per-language SDKs
on demand, CloudEvents-style.

**Sharing the instance across same-origin frames via `parent.globalThis`.**
Rejected: a frame's subscriptions would outlive the frame; cross-realm
objects break `instanceof`; cross-origin frames cannot do it anyway. A
frame runs its own runtime and connects through a transport.

**Remote discovery / handshake frames.** Deferred: "the host declares
remotes" is the same rule as "the host provides the runtime", and it keeps
the wire stateless.

## Open questions

1. `RemoteClient.forward(pattern)` as a method (this RFC) versus
   `on(topic)` without a handler on a shared interface. Method preferred
   for typing; confirm.
2. Name: `link` versus keeping `bridge` for the realm-to-realm case.
3. Should `forward()` accept `{ replay }` so a reconnecting backend gets the
   last retained snapshot? Additive; wait for a real need.
4. Default request timeout: on the remote client (this RFC) or a global
   `BrokerConfig` default.

## Security notes

- Identity binding closes source spoofing for remote clients
  structurally; links require an explicit source policy.
- `allowedOrigins` is mandatory for `postmessage`; `message-port` trusts
  possession; `websocket` and `sse` authentication is the application's
  responsibility (documented in the threat model).
- Size and rate limits at ingress are per remote client / link.
- The handle on `globalThis` and the SDK add no capability that same-realm
  code did not already have through the module graph.
