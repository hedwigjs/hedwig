# RFC 0003 — Participants, runtime/SDK split and the wire

- **Status:** Draft, revision 2
- **Created:** 2026-09-13 (rev. 1) · 2026-09-13 (rev. 2, after independent review)
- **Owners:** —
- **Supersedes:** [RFC 0001 — Transport adapters](./0001-transport-adapters.md)

Revision 2 folds in the findings of three independent reviews of
revision 1 (broker/protocol design, frontend-platform practice,
proportionality). The changes are listed in
[What changed in revision 2](#what-changed-in-revision-2).

## Summary

Three changes that together replace the current "bridge" model:

1. **Every participant is a client.** A client is either *local* (the
   participant's code runs in this realm) or *remote* (the participant
   runs on the far side of a transport and is represented here by a
   proxy). The proxy works in both directions: deliveries to the remote's
   own subscriptions become outbound frames, and inbound frames become
   messages emitted under an identity the *local* side controls — which
   local clients receive with their own handlers, exactly as if a local
   client had emitted. Requests to a remote client are ordinary unicasts.
   A remote client declares how many identities its wire carries: one
   fixed name, an allow-list, or many unknown names with a prefix. This
   last mode is what revision 1 called a "link"; it is no longer a
   separate concept.
2. **The library splits into a runtime and an SDK.** The host installs
   `@hedwigjs/broker` (runtime) once and registers a handle on
   `globalThis`. Modules install `@hedwigjs/client` (SDK): types plus a
   locator, no core, no transports, no state. Modules on different SDK
   versions coexist against one runtime and migrate on their own schedule.
3. **The wire is a specification.** Everything beyond a transport — a
   backend, an iframe form — implements a published envelope format with a
   JSON Schema, and depends on no package.

## Motivation

The current design has one abstraction, `addBridge(id, { transport,
forward })`, for every cross-context case. Verified findings against
`packages/broker/src` (2026-09-12), with their status after step 1 of
the plan (2026-09-13):

- **Identity is not modelled.** `source` came off the wire verbatim and
  the demo ACL keyed on it. *Step 1 added `allowedSources` and field
  validation as a floor; the model below removes the class of bug.*
- **Requests could not cross a transport.** A unicast to an unregistered
  recipient resolved `NACK NOT_SUBSCRIBED` locally, was still forwarded,
  executed on the remote side, and the result was discarded. *Step 1
  stopped forwarding unicasts; the model below makes requests to remotes
  work.*
- **Two-step API for the common case.** A module that owns an iframe or a
  streaming response writes `createClient()` for itself *and*
  `getBroker().addBridge()` for the wire, then must remember to remove
  the bridge on unmount.
- **Version drift across modules has no story.** Microfrontends deploy
  independently; a shell cannot make every module upgrade the library on
  the same day, yet every module today bundles the whole core. The
  realm registry (landed before this RFC) makes duplicate copies share
  one instance and refuses incompatible ones; it does not let a module
  stay on an older SDK deliberately.
- **Backends hand-craft the envelope.** *Step 1 reduced the demo to one
  helper; the format itself is still convention until the wire spec.*

The first version of this library modelled transports *as clients*. The
split into clients and bridges happened because one wire can carry many
participants (another tab). That was a real constraint, but it threw
away the modelling of single-identity remotes along with it. This RFC
restores it, and treats "many participants" as an identity mode rather
than a different kind of thing.

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
- Cancelling or streaming responses in this revision; the wire reserves
  room for both (§6).

## Terminology

| Term | Meaning |
| --- | --- |
| **Realm** | One JavaScript global: a window, an iframe, a worker. One runtime per realm. |
| **Runtime** | `@hedwigjs/broker`. Core, transports, `initBroker`, tooling surface. Installed by the host. |
| **SDK** | `@hedwigjs/client`. Types plus a locator. Installed by modules. |
| **Handle** | The object the runtime registers on `globalThis`; the only contract between runtime and SDK. |
| **Participant / client** | Anything with an id that sends or receives messages. Local or remote. |
| **Local client** | The participant's code runs in this realm. `createClient(id)`. |
| **Remote client** | The participant runs beyond a transport; locally a proxy. Its own subscriptions (`forward`) are served by sending frames out; frames it sends in are routed to local subscribers under an identity the local side controls. `createRemoteClient(id, { transport, identity, … })`. |
| **Identity mode** | How a remote client maps inbound frames to `source`: one fixed name, an allow-list, or a prefix for unknown names. |
| **Transport** | A duplex (or inbound-only) pipe: `send` / `onMessage` / `destroy`. Built-in or custom. |
| **Wire** | The JSON frame format that crosses a transport. Specified, versioned, schema-described. |

## Design

### 1. Packages

```
@hedwigjs/broker   runtime  — host only.  core, routing, history, backpressure,
                              transports, initBroker, inspect, $systemEvents,
                              hooks, $debug, DevTools surface.
@hedwigjs/client   SDK      — modules.    createClient, createRemoteClient,
                              hasCapability, getRuntimeInfo, whenRuntimeReady,
                              and every type a module can see.
@hedwigjs/devtools           — host only. Attaches to the runtime as today.
@hedwigjs/create-registry    — dev tool.  Unchanged.
```

Dependency direction: the runtime depends on the SDK for types and
re-exports them for host authors. The SDK depends on nothing at runtime
and has no peer dependency on the runtime package; it requires "a
runtime providing ABI 1 and version ≥ N", checked at runtime (§2).

A separate package rather than a second entry point of the runtime: with
an entry point a module's `package.json` would still pin a *runtime*
version it never uses, so a runtime major bump would force every module
to touch its dependencies. With `@hedwigjs/client` the runtime version
is invisible to modules. The cost — two semver lines, build order,
changesets — is accepted.

Module Federation guidance: the host does **not** share
`@hedwigjs/broker`; it is private to the host. Modules may bundle the SDK
freely — duplicates are harmless, it holds no state. Where an estate
already uses `shared`, `import: false` plus `strictVersion: true` on the
remote side is a valid second layer that fails at load time; it is not
required for correctness. Import-map estates use `externals` plus one
map entry.

`initBroker()` in a realm that already has a handle throws
`RUNTIME_ALREADY_PROVIDED`. A second runtime is a configuration error,
never a second bus. (The realm registry that landed before this RFC
already enforces "one core per realm" among copies of the runtime and
refuses incompatible versions; the handle is the same slot seen from the
SDK side.) Module templates add an ESLint `no-restricted-imports` rule
for `@hedwigjs/broker`, scoped to `src/**` and exempting standalone-dev
and test entries, which legitimately boot their own runtime.

### 2. The handle

```ts
// @hedwigjs/client — handle.ts
export const ABI = 1;
export const RUNTIME_KEY: unique symbol = Symbol.for(`@hedwigjs/runtime/${ABI}`);

export interface RuntimeHandle {
  readonly abi: number;                       // this handle's ABI (matches the key)
  readonly runtimeVersion: string;            // npm version of @hedwigjs/broker
  readonly capabilities: ReadonlySet<string>; // feature detection, see §4, §7
  createClient(id: string, options: ClientOptions, meta: ClientMeta): Client<any, any>;
  createRemoteClient(id: string, options: RemoteClientOptions, meta: ClientMeta): RemoteClient;
}

export interface ClientMeta {
  sdkVersion: string;  // version of @hedwigjs/client making the call
}
```

**One symbol per ABI.** The ABI number is in the key, as in
OpenTelemetry's `Symbol.for('opentelemetry.js.api.<major>')`. A runtime
that must break the contract registers *two* handles, `…/1` and `…/2`,
each with its own surface, for a deprecation window; SDKs on ABI 1 keep
working, DevTools shows which client uses which ABI, and the host drops
`…/1` when the panel and its telemetry show nobody left. Revision 1's
single handle with `abi: number[]` could not describe how two ABIs
shared one `createClient`; this can.

**Two gates in the SDK locator.** Missing key → `RUNTIME_NOT_PROVIDED`.
Key present but `runtimeVersion` below the SDK's `minRuntime` (a constant
baked into each SDK release) → `RUNTIME_TOO_OLD`. The second gate is what
OpenTelemetry's `isCompatible()` does: a newer SDK never calls into an
older runtime that silently lacks what the SDK's types promise. Within
the same ABI the runtime only grows; `capabilities` announces optional
features for code that wants to degrade gracefully instead of failing.

**Lazy proxy before the runtime exists.** Every module in the demo
creates its client at module scope (`export const bus =
createClient(...)`), so throwing at import would push boot-order onto
every module. Instead `createClient()` returns a proxy immediately: `on()`
records the subscription, `emit()` / `request()` queue with a bounded
buffer (default 64; overflow → `NACK RUNTIME_NOT_READY` for the oldest),
and everything flushes in order when the runtime registers. The runtime
dispatches `hedwig:runtime-ready` on `globalThis` (guarded: only where
`globalThis` is an `EventTarget`); `whenRuntimeReady()` resolves on it or
immediately. `createRemoteClient()` is not proxied — a transport needs a
live runtime; it throws `RUNTIME_NOT_PROVIDED` and the caller awaits
`whenRuntimeReady()` first.

**Registration.** From `initBroker()` via `Object.defineProperty(globalThis,
RUNTIME_KEY, { value, enumerable: false, writable: false, configurable:
true })`; removed by `destroyBroker()`. Lazy, never at import time, so
`sideEffects: false` stays true.

**SDK errors.** All carry a `code` and an actionable message. None create
anything.

| Code | When |
| --- | --- |
| `RUNTIME_NOT_PROVIDED` | No handle for this ABI. "Call `initBroker` in the host before mounting modules, or await `whenRuntimeReady()`." |
| `RUNTIME_TOO_OLD` | `runtimeVersion` below the SDK's `minRuntime`. |
| `RUNTIME_ALREADY_PROVIDED` | Thrown by the runtime's `initBroker` when a handle exists. |
| `CLIENT_ID_TAKEN` | Creating a client whose id exists (§3). |
| `TRANSPORT_UNSUPPORTED` | Descriptor `kind` not in `capabilities`. |
| `TRANSPORT_FANOUT` | A request sent to a remote on a fan-out transport (§7). |

The slot is hygiene, not security: anything in the realm could already
reach the broker through the module graph.

### 3. Participants

Two interfaces, because a single one would carry methods that are
meaningless for one of the kinds. On a remote client, `emit` is something
the far side does (it shows up here as an inbound frame), and `on(topic,
handler)` has no local handler to attach — the remote's subscription is
served by sending it frames, which is what `forward(pattern)` declares.
Local clients that want to *receive* what the remote sends subscribe as
usual with `on()`; those handlers are theirs, not the remote's.

```ts
// Local — as today.
interface Client<T extends string, P extends Record<T, any>> {
  readonly id: string;
  on<K extends T>(topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): () => void;
  off<K extends T>(topic: K): void;
  emit<K extends T>(topic: K, data: P[K], options?: MessageOptions): Promise<RoutingResult>;
  request<K extends T, R = unknown>(to: string, topic: K, data: P[K], options?: RequestOptions): Promise<RoutingResult<R>>;
  reset(): void;
  destroy(): void;
}

// Remote — handlers behind a transport.
interface RemoteClient {
  readonly id: string;
  readonly kind: string;          // 'websocket' | 'sse' | 'postmessage' | 'message-port' | 'broadcast-channel' | 'custom'
  readonly duplex: boolean;
  readonly fanout: boolean;
  readonly requests: boolean;     // duplex && !fanout — may be a request recipient
  readonly ready: Promise<void>;  // transport handshake done (§4)
  readonly pending: number;       // requests in flight to this remote (§7)
  forward(pattern: string | string[]): () => void;  // topics delivered to the remote — its subscriptions
  accept(pattern: string | string[]): () => void;   // topics it may inject — extends `accepts`
  destroy(): void;                // closes the transport, fails pending requests with REMOTE_GONE
}

type RemoteIdentity =
  | { mode: 'fixed' }                    // every inbound frame is `source = id`
  | { mode: 'allow'; sources: string[] } // inbound `source` must be listed
  | { mode: 'prefix'; prefix?: string }; // inbound `source` kept, prefixed (default: the remote's id)

interface RemoteClientOptions {
  transport: TransportDescriptor | Transport;
  identity?: RemoteIdentity;      // default: { mode: 'fixed' }
  accepts?: string[];             // topics it may inject; default: nothing
  forward?: string[];             // initial subscriptions
  timeout?: number;               // default for requests to this remote (§7)
  maxBytes?: number;              // string frames only (WebSocket, SSE)
  rateLimit?: { max: number; window: number };
}

interface ClientOptions {
  onConflict?: 'throw' | 'reset'; // default 'throw'
}
```

**Identity modes.** `fixed` is the single-participant case (a backend, an
iframe): a frame that carries no `source` gets the remote's id; a frame
that carries a *different* `source` is rejected as
`remote.frame.rejected { reason: 'SOURCE_MISMATCH' }` — never silently
rewritten, because a backend that believes it is `menu` is a
misconfiguration worth seeing. `allow` is the gateway case: one socket,
several known services behind it. `prefix` is the foreign-realm case
(another tab, a worker running its own runtime): unknown ids come
through as `<prefix>:<id>`, so `tab:cart-store` cannot collide with the
local `cart-store`; the prefix is optional and defaults to the remote's
id. Which mode is right is a property of the peer, not of the transport.

**Creation and conflicts.** `createClient(id)` and `createRemoteClient(id,
…)` register in one client registry. An id that already exists is an
error (`CLIENT_ID_TAKEN`) — in a thirty-module estate two teams picking
`analytics` must not silently wipe each other's subscriptions. The
previous idempotent-reset behaviour, which exists for HMR, is opt-in:
`createClient(id, { onConflict: 'reset' })`; HMR templates use
`module.hot.dispose(() => client.destroy())` instead. A remote created by
the host cannot be re-created from a module (`CLIENT_ID_TAKEN`, no reset
option): otherwise a semi-trusted module could re-attach
`notifications-backend` to its own socket and inherit the host's trust.

**Lifecycle.** A remote client is a disposable: `destroy()` (and
`Symbol.dispose` for `using`). There is no ownership graph; binding a
remote to a component's lifetime is the adapters' job
(`useRemoteClient(id, options, deps)` in React, the equivalent composable
in Vue), exactly as Comlink's `releaseProxy`, penpal's `destroy()` and
single-spa's `unmount` do it. `reset()` on a local client never touches
remotes.

**Who creates what.** The rule is lifecycle ownership. The host creates
remotes that many modules consume and that live as long as the page (the
backend notifications socket, the cross-tab channel). A module creates
remotes that exist for its own sake (its iframe, its streaming reply, its
worker).

### 4. Transports

```ts
// @hedwigjs/client — types/transport.ts
interface Transport {
  send(frame: unknown): void;                        // must not throw; runtime isolates it anyway
  onMessage(cb: (frame: unknown) => void): () => void;
  destroy(): void;                                   // idempotent
  readonly duplex?: boolean;                         // default true; SSE is false
  readonly fanout?: boolean;                         // default false; BroadcastChannel is true
  readonly ready?: Promise<void>;                    // resolves when frames can be sent; default: resolved
  onClose?(cb: () => void): () => void;              // optional: fail pending requests early
}

type TransportDescriptor =
  | { kind: 'postmessage';       target: Window; allowedOrigins: string[]; targetOrigin: string }
  | { kind: 'message-port';      port: MessagePort }
  | { kind: 'websocket';         socket: WebSocket }
  | { kind: 'sse';               url: string; withCredentials?: boolean; eventName?: string }
  | { kind: 'broadcast-channel'; name: string };
```

Built-in implementations stay in the runtime and are updated with it. A
module never imports them; it passes a descriptor and the runtime
instantiates its own class. A custom transport is an object implementing
`Transport`; after creation the runtime treats both identically. The
runtime lists what it provides in `capabilities`:
`transport.postmessage`, `transport.message-port`, `transport.websocket`,
`transport.sse`, `transport.broadcast-channel`.

Changes to the built-ins:

- `postmessage`: `allowedOrigins` (inbound) and `targetOrigin` (outbound)
  are both mandatory. The `'*'` default is gone in both directions; the
  demo's iframe already targets its parent's origin. Inbound frames from
  other origins are dropped as `remote.frame.rejected { reason: 'ORIGIN' }`.
- `message-port`: new. `MessagePort` from a `Worker`, `SharedWorker` or
  `MessageChannel`. No origin concept — possession of the port is the
  trust.
- `broadcast-channel`: `fanout: true`; usable only with a remote whose
  `requests` is therefore `false`. Same-origin trust only: any document of
  the origin, including an injected script, can write to it — hence the
  identity mode is mandatory in practice.
- `ready`: `postmessage` to an iframe before it has loaded silently drops;
  `websocket` before `OPEN` warned to the console. `forward()` and
  `request()` wait for `ready` (bounded by the request timeout); a `send`
  that still fails is `remote.send.failed { reason: 'NOT_OPEN' }` on
  `$systemEvents`, never `console.warn`.
- All transports log through the runtime's `BrokerLogger`.

Connection management stays outside the transport: the application opens
the socket, the transport wraps it. On reconnect the owner destroys the
remote (pending requests fail with `REMOTE_GONE`) and creates it again
with the new socket.

### 5. Foreign realms (formerly "links")

A tab, or a worker with its own runtime, is a remote client with
`identity: { mode: 'prefix' }`. Nothing else is special. What follows
from the pieces already defined:

- Over a fan-out transport (`broadcast-channel`) `requests` is `false`:
  a request would reach every tab and every tab would execute and answer.
  `request()` to such a remote resolves `NACK TRANSPORT_FANOUT` before
  anything is sent. Cross-tab *requests* need a hub (a `SharedWorker`
  with one `message-port` per tab), which is then an ordinary remote.
- Over a 1:1 transport (`message-port` to a worker running a runtime)
  `requests` is `true`; `request('worker:search', …)` strips the prefix
  and sends `target: 'search'`; the far runtime unicasts to its local
  `search`.
- Cross-tab state sync in the demo is *replication*, not synchronisation:
  `cart.snapshot.v1` is forwarded, the last writer wins, and each tab's
  store keeps its own state. The prefix makes the foreign snapshot
  distinguishable (`tab:cart-store`) for DevTools and for handlers that
  care; it does not make the stores converge, and the RFC does not claim
  it does. Frames from foreign realms are not recorded to history and
  never re-forwarded.

### 6. The wire

The wire is a specification, `docs/content/spec/envelope-v1.md`, with a
JSON Schema, `envelope-v1.schema.json`, published as a file inside the
runtime package. No npm package is required to produce frames; the demo
backend builds plain objects through one helper and validates them
against the schema in its tests. The runtime performs a *structural check
equivalent to the schema* at ingress; it does not embed a JSON Schema
validator.

```jsonc
{
  "v": 1,                              // wire version
  "id": "01J9…",                       // producer-scoped; kept as `wireId` on the message
  "origin": "realm-7f3a",              // producing realm's session id — loop guard
  "kind": "event",                     // "event" | "request" | "response"
  "topic": "notification.show.v1",
  "source": "notifications-backend",   // validated per identity mode (§3)
  "target": "*",                       // "*" or a client id
  "data": { … },
  "timestamp": 1789238807425,
  "correlationId": "…",                // request: own id; response: the request's id; event: optional (streams)
  "deadline": 1789238812425,           // request: absolute ms after which the far side may drop it
  "ext": { "traceparent": "…", "hedwig": { "claimedSource": "…" } }
}
```

Rules:

- **Ids.** The producer's `id` is kept on the message as `wireId`
  together with `source`; the receiving runtime assigns its own `id` for
  local bookkeeping. `(source, wireId)` is the deduplication key, the
  cross-realm DevTools stitching key, and the idempotency token a backend
  can rely on. Ids are UUIDs, never per-process counters.
- **Loop guard.** `origin` is the producing realm's session id. A frame
  whose `origin` equals the local realm's is dropped at ingress
  (`remote.frame.rejected { reason: 'ECHO' }`). Together with "never
  re-forward external frames" this also stops the application-level loop
  where a handler re-emits what it just received.
- **Local-only flags** (`replayed`, `fromExternal`, `synthetic`, `via`)
  never go on the wire. Outbound frames are built from the message, not by
  serialising the internal object.
- **Evolution.** Unknown top-level fields: ignore (`additionalProperties:
  true`). Unknown `kind` or `v` greater than supported: reject
  (`UNSUPPORTED`). Missing `v` and `kind` are tolerated for one wire
  version: `kind` defaults to `target === '*' ? 'event' : 'request'`.
  `ext` is opaque and passed through untouched; `ext.hedwig.*` is reserved
  for runtime-owned keys (`claimedSource` is the `source` a `fixed`-mode
  remote's frame carried when it was empty-or-equal; a *different* one is
  a rejection, §3); `ext.traceparent` / `ext.tracestate` are the named
  slots for W3C trace context. Encoding is JSON; binary payloads are legal
  only over structured-clone transports (`postmessage`, `message-port`,
  `broadcast-channel`).
- **Responses** are flat: `{ v, kind: 'response', correlationId, topic,
  source, target, status, reason, message, data?, details? }`. `reason` is
  a closed enum published in the spec — a Go or Python backend must
  produce values the browser's `RoutingReason` switch understands. No
  stack traces cross the wire.
- **Ingress order** for a remote client: size limit → rate limit →
  structural check → `v` / `kind` support → `origin` echo guard → topic in
  `accepts` (requests and events) or matching pending entry (responses) →
  identity mode → pipeline. Each rejection is a `remote.frame.rejected {
  remoteId, reason }` system event and a log line; the frame never reaches
  a hook. Response frames bypass `accepts`; they are matched by
  `correlationId` only.
- **Reserved for later revisions:** `kind: 'cancel'` (with the request's
  `correlationId`) and `correlationId` on `kind: 'event'` for streamed
  partial results. The AI reply in the demo is a stream of events today;
  it becomes a correlated stream without a format change.

### 7. Pipeline changes

**Inbound (remote client).** Transport → ingress checks (§6) →
`Message` with `source` per identity mode, `via = remote.id`, fresh local
`id`, `wireId`, `origin` → `beforeSend` hooks → routing → `afterSend`.
Not recorded to history, not forwarded to any transport.

**Outbound.** After local delivery and `afterSend`, for every remote
client whose `forward` matches the topic: build the wire frame, call
`transport.send` after `ready`, isolated per remote (`remote.send.failed {
remoteId, topic, messageId, reason }`; the others still receive). A
message that arrived over a transport is never sent to any transport.

**`forward` is evaluated after local routing**, like today's bridge
patterns, because the core's subscription index is keyed by exact topic
and `forward` takes globs. Consequences, stated explicitly: `onSubscribe`
hooks run at `forward()` time with the pattern and the remote's id (a
policy may deny the pattern); `recipientIds` on the emitter's
`RoutingResult` include the remote ids that matched; `NO_SUBSCRIBERS` is
returned only when neither a local subscriber nor a forwarding remote
matched. Wildcard subscriptions for local clients remain out of scope.

**Request to a remote client.** `local.request(remote.id, topic, data)`:

1. Recipient resolution is by the client registry. A remote client *is*
   registered, so the request is a unicast to it — no local
   `NOT_SUBSCRIBED`, no double execution.
2. `remote.requests === false` → `NACK TRANSPORT_ONE_WAY` (inbound-only)
   or `NACK TRANSPORT_FANOUT` (fan-out) immediately.
3. Otherwise a `kind: 'request'` frame with `correlationId = wireId` and
   `deadline = now + timeout` is sent after `ready`; a pending entry `{
   correlationId, timer }` is kept **on the remote client**, never global.
   Default timeout comes from `RemoteClientOptions.timeout` (5000 ms),
   overridable per call.
4. A `kind: 'response'` frame with a matching `correlationId` arriving
   **over that remote's transport** resolves the pending entry with the
   embedded result; responses over any other path are ignored.
5. Timeout → `NACK TIMEOUT`. The far side may still execute the request;
   the spec says so, and retries are the caller's decision, keyed by
   `wireId` as the idempotency token. `remote.destroy()` → `NACK
   REMOTE_GONE` for every pending entry; `destroyBroker()` → `NACK
   BROKER_DESTROYED`.
6. Exactly one `afterSend` fires for the request, with the final result and
   `via = remote.id`. Wire-level trace goes to `$systemEvents`:
   `request.forwarded`, `response.received { latencyMs }`,
   `request.timeout`.

**Request from a remote client.** A `kind: 'request'` frame targets a
local client and is routed as a unicast. *Every* outcome produces a
response frame back over the same transport: the handler's result,
`HANDLER_FAILED`, `NOT_SUBSCRIBED`, `HOOK_REJECTED` when a `beforeSend`
hook denied it (otherwise the peer waits for its own timeout), and
`SERIALIZATION_FAILED` when the handler's return value cannot be encoded
(JSON `BigInt`, cyclic objects). Errors are serialised as `{ reason,
message }` only.

**Local requests** are unchanged (in-process await of the handler's
return value); `timeout` already applies to them since step 1.

**Delivery semantics, written down.** At-most-once everywhere. `ACK
DISPATCHED` means handed to subscribers, not processed; `ACK DELIVERED`
means the unicast handler returned. Ordering: FIFO per source within a
realm and per direction per transport; no ordering across transports.
Backpressure strategies drop or delay *after* the emitter got its ACK.
One responder per `(client, topic)`. Replay is synchronous inside `on()`.

### 8. Policy

- `onSubscribe` hooks run for `remote.forward(pattern)` with the remote's
  id, exactly as for local `on()`. An ACL that says "`analytics` may not
  subscribe to `cart.*`" needs no separate rule set for remotes.
- `beforeSend` hooks see `message.via` (the remote id) and a `source` that
  the runtime, not the peer, validated. Policies may key on either.
- `$debug.send` requires `initBroker({ debug: true })` (landed).
- Guard hooks fail closed by default (landed in step 1).

### 9. DevTools

- **Clients** tab lists local and remote clients. Remote rows show a
  `remote` badge, transport `kind`, identity mode, `duplex` / `fanout` /
  `requests`, pending requests, and `ready` state. Every row shows
  `sdkVersion` and the ABI it came through, from `ClientMeta` — useful as
  a diagnostic on the current route; the estate-wide migration map is
  `client.registered` (which now carries `ClientMeta`) shipped to
  telemetry, plus contracts versions in build manifests.
- **Bridges** tab is removed; its content moves into Clients.
- Messages from a remote show `via <id>` instead of the generic
  `external` pill; request/response pairs are stitched by `correlationId`
  with latency; `wireId` is shown for cross-realm correlation.
- New system events rendered: `remote.frame.rejected`, `remote.send.failed`,
  `remote.gone`, `request.forwarded`, `response.received`, `request.timeout`.
- Handshake: the panel compares `runtimeVersion` with the runtime version
  it was built against under the semver rule (landed in step 1) and shows
  a header badge on mismatch.

### 10. Versioning and compatibility

- Runtime and SDK follow semver independently. The runtime may move fast;
  only the host updates it.
- `ABI` is an integer in the handle's symbol, changed only when the
  handle contract breaks — expected to be rare. Each SDK release carries
  `minRuntime`, the oldest runtime whose behaviour matches the SDK's
  types. There is no separate "protocol version".
- Within an ABI the runtime only adds; optional features are announced in
  `capabilities` for graceful degradation, and gated by `minRuntime` for
  everything the SDK's types depend on.
- Topic contracts (`@my-org/topics`) version independently, per topic
  (`.vN`). This is the axis that actually drifts in an estate; the broker
  does not police it, the contracts registry and CI do.
- The wire has its own `v`; the runtime accepts `v: 1` and tolerates
  missing `v` for one version.

### 11. Migration of existing code

| Today | After |
| --- | --- |
| `import { createClient } from '@hedwigjs/broker'` in a module | `from '@hedwigjs/client'` |
| `getBroker().addBridge('ai-backend-stream', { transport: new SSETransport({ url }), forward, allowedSources: ['ai-backend'] })` | `createRemoteClient('ai-backend', { transport: { kind: 'sse', url }, accepts: ['chat.reply-*'] })`, destroyed in the hook's cleanup |
| `getBroker().addBridge('checkout-iframe', { transport: new PostMessageTransport({ target, origin }), forward, allowedSources: ['checkout-iframe'] })` | `createRemoteClient('checkout-iframe', { transport: { kind: 'postmessage', target, allowedOrigins: [ORIGIN], targetOrigin: ORIGIN }, accepts: ['checkout.completed.v1'] })`, destroyed when the modal closes |
| shell: `addBridge('backend-notifications', { transport: new WebSocketTransport(socket), forward: ['notification.show.v1'], allowedSources: ['notifications-backend'] })` | shell: `createRemoteClient('notifications-backend', { transport: { kind: 'websocket', socket }, accepts: ['notification.show.v1'] })` |
| shell: `addBridge('cross-tab-cart', { transport: new BroadcastChannelTransport(name), forward: ['cart.snapshot.v1'], allowedSources: ['cart-store'] })` | shell: `createRemoteClient('tabs', { transport: { kind: 'broadcast-channel', name }, identity: { mode: 'prefix', prefix: 'tab' }, forward: ['cart.snapshot.v1'], accepts: ['cart.snapshot.v1'] })` |
| ACL: separate entries for "fictitious" sources | ACL: the same client rules; remote ids are real clients. Foreign-realm ids carry the prefix (`tab:cart-store`) and the ACL is updated accordingly |
| backend: one `createEnvelope` helper (step 1) | backend: the helper produces `v: 1` frames with `origin`; frames validated against the schema in tests |

`addBridge` and the exported transport classes are removed from the
public surface (pre-release; changeset `minor`).

### 12. Implementation plan

Lockstep with DevTools in every step; one changeset per step; nothing is
pushed until the sequence is reviewed.

| Step | Scope | Size | Status |
| --- | --- | --- | --- |
| 1 | Version-based realm slot (no PROTOCOL_VERSION); fail-closed hooks; unicast bypasses backpressure; request timeout; `noLocal`; no requests over bridges; frame validation; `allowedSources`; iframe `targetOrigin`; backend envelope helper | S–M | done 2026-09-13 |
| 2 | This revision of the RFC | S | done |
| 3 | Remote clients (§3, §4, §5, §6 ingress, §7 inbound/outbound): `createRemoteClient` with identity modes, descriptors, `message-port`, `ready`, `remote.*` events; `addBridge` removed; demo's four bridges become remote clients | L | todo |
| 4 | Wire (§6): envelope v1 + `docs/content/spec/*`; backend validated by schema | M | todo |
| 5 | Requests to/from remote clients (§7); DevTools pairing | L | todo |
| 6 | `@hedwigjs/client` package + handle (§1, §2): lazy proxy, gates, `ClientMeta`; demo modules on the SDK | M | todo |

Steps 7–10 (topic classes in contracts, React/Vue adapters on the SDK,
transport conformance kit and e2e, CI) follow and are tracked outside this
RFC.

## What changed in revision 2

Accepted from review:

- `link` folded into remote clients as `identity: { mode: 'prefix' }`;
  request eligibility derived from the transport (`duplex && !fanout`),
  not from the participant kind. A worker with its own runtime over a
  1:1 port can now be a request recipient; a multiplexing gateway has a
  sanctioned `allow` mode.
- Identity mismatch is a rejection (`SOURCE_MISMATCH`), not a silent
  rewrite; empty `source` is filled.
- `owner` removed; remotes are disposables, lifecycle binding lives in
  the adapters. `reset()` never cascades.
- Duplicate client ids are an error by default; reset is opt-in; host
  remotes cannot be re-created from modules.
- One handle symbol per ABI; `minRuntime` version gate in the SDK; lazy
  proxy client before the runtime registers; MF `import: false` /
  `strictVersion` documented as an optional second layer.
- Wire: producer `id` kept as `wireId` with `(source, wireId)` as the
  dedup key; `origin` as loop guard; `targetOrigin` in the postmessage
  descriptor; flat response frames with a closed `reason` enum; evolution
  rules; reserved `ext.hedwig.*` and `ext.traceparent`; structural check
  in the runtime, schema as the normative artefact; `deadline`; reserved
  `cancel` and correlated events.
- Every inbound request gets a response, including hook rejections and
  serialisation failures; timeout semantics stated (not cancelled,
  retries are the caller's, idempotency by `wireId`).
- `ready` on transports; `NOT_OPEN` as a system event.
- `forward` evaluated post-routing, with `onSubscribe` /
  `recipientIds` / `NO_SUBSCRIBERS` behaviour stated.
- Delivery semantics written down (§7).
- Motivation updated to the state after step 1; the bundle-size argument
  dropped (the runtime is ~7.5 KB gzip).

Kept after review, with the objection recorded:

- **Separate SDK package** rather than a second entry point. Two of three
  reviewers preferred the entry point until adapters exist. Decided for
  the package: with an entry point every module would pin a runtime
  version it never uses.
- **DevTools per-client `sdkVersion`** kept as a diagnostic, not sold as
  the migration map; telemetry via `client.registered` is.

Deferred to after 1.0, recorded here so they are not lost: a `retain`
primitive instead of the general history ring buffer; moving throttle /
debounce / rateLimit out of the core into SDK-level handler decorators
(they shape consumption, they are not backpressure); egress
`maxBufferedBytes`.

## Alternatives considered

**Keep one `Client` interface with optional transport.** Rejected: half
the methods would be meaningless for one kind, and the type system could
not say which.

**A separate `link` construct for foreign realms** (revision 1).
Rejected after review: it differed from a remote client only in identity
cardinality and a request ban that really belongs to fan-out transports.

**Silently rewrite a mismatching `source`** (revision 1). Rejected: it
hides misconfiguration; RabbitMQ's `user-id` rule (validate, reject on
mismatch) is the precedent.

**`owner` binding a remote to a local client** (revision 1). Rejected:
demo clients are module-level singletons, so `owner.destroy()` would
never fire; Comlink, penpal and single-spa all use explicit dispose bound
to the framework lifecycle.

**Per-transport npm packages** (RFC 0001). Rejected: the reason was to
keep transport code out of module bundles; with the SDK split, modules
contain no transport code by construction.

**A hand-maintained `PROTOCOL_VERSION`.** Implemented briefly, then
removed in step 1: a second versioning axis that duplicated semver and
whose "different version → separate broker" consequence violated the
one-broker invariant. Replaced by the version-based realm slot, the ABI
in the handle symbol and `minRuntime`.

**A Node SDK for backends** (`@hedwigjs/wire`). Deferred: the wire is a
spec; a schema file is enough for one demo backend.

**Sharing the instance across same-origin frames via `parent.globalThis`.**
Rejected: a frame's subscriptions would outlive the frame; cross-realm
objects break `instanceof`; cross-origin frames cannot do it anyway.

**Remote discovery / handshake frames.** Deferred: "the host declares
remotes" is the same rule as "the host provides the runtime", and it keeps
the wire stateless.

## Open questions

1. Should `forward()` accept `{ replay }` so a reconnecting backend gets the
   last retained snapshot? Additive; wait for a real need.
2. Default request timeout for remotes: on the remote (this RFC, 5 s) or a
   global `BrokerConfig.request.timeout` only.
3. Topic-class contracts (step 7): one contract type with `kind`, or two.

## Security notes

- Identity modes close source spoofing structurally for `fixed` and
  `allow` remotes; `prefix` remotes namespace foreign ids so they cannot
  impersonate local clients.
- `allowedOrigins` and `targetOrigin` are mandatory for `postmessage`;
  `message-port` trusts possession; `broadcast-channel` trusts the whole
  origin; `websocket` and `sse` authentication is the application's
  responsibility (documented in the threat model).
- Size and rate limits at ingress are per remote client; `origin` guards
  against echo loops.
- The handle on `globalThis` and the SDK add no capability that same-realm
  code did not already have through the module graph.
