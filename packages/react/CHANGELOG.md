# @hedwigjs/react

## 0.2.1

### Patch Changes

- [#23](https://github.com/hedwigjs/hedwig/pull/23) [`4c76703`](https://github.com/hedwigjs/hedwig/commit/4c767036d5f5d6422e3780b2857435f75c1fd6cf) Thanks [@pipinov](https://github.com/pipinov)! - Fixes from the post-0.2.0 code review.

  Runtime: `maxBytes` now applies to every transport (text transports report
  the wire length via the new optional `TransportFrameMeta` argument of the
  `onMessage` callback, structured-clone transports are measured as JSON when
  the limit is set); an inbound request's deadline bounds the local handler
  (budget = deadline − timestamp, in the sender's clock) instead of being
  ignored; WebSocket, postMessage and BroadcastChannel transports throw on a
  failed send so `remote.send.failed` can fire (send after destroy stays a
  no-op); `on()` refuses a wildcard topic with a `TypeError` — patterns are
  for `accepts` / `forward` and hooks; new `initBroker({ payloads: 'clone' })`
  copies payloads with `structuredClone` before freezing, for hosts that
  would rather pay for a copy than freeze the emitter's object in place.

  SDK: `createClient` no longer throws `RUNTIME_TOO_OLD` at module scope —
  it returns a blocked client whose calls answer `NACK RUNTIME_TOO_OLD` (new
  routing reason) and logs once; `whenRuntimeReady()` rejects instead of
  throwing when the runtime present is too old; a lazy client binds each
  subscription in isolation, so one rejected subscription no longer leaves
  the queued emits and requests stuck.

  create-registry: the generator reads `name` / `kind` / `response` /
  `retention` from the TypeScript AST of the contract's default export, so a
  payload with a field called `kind` or `response` no longer breaks the build.

  Docs: "retained value before first paint" is qualified (holds when the
  runtime is already there; a lazy client delivers it when it binds).

- Updated dependencies [[`4c76703`](https://github.com/hedwigjs/hedwig/commit/4c767036d5f5d6422e3780b2857435f75c1fd6cf)]:
  - @hedwigjs/client@0.3.0

## 0.2.0

### Minor Changes

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`1a8d60a`](https://github.com/hedwigjs/hedwig/commit/1a8d60ae1170cdb2771c9f14861d1c00a73c29f0) Thanks [@pipinov](https://github.com/pipinov)! - `bindHooks(client)` (React) and `bindComposables(client)` (Vue): the
  three data hooks — `useTopic`, `useStateTopic`, `useRequest` — with the
  client already filled in, for modules that create one client at module
  scope. `useStateTopic('cart.snapshot.v1')` instead of
  `useStateTopic(bus, 'cart.snapshot.v1')`; types unchanged. The reference
  stand's cart, menu and notifications MFEs use the bound form.

- [#3](https://github.com/hedwigjs/hedwig/pull/3) [`b8b59a4`](https://github.com/hedwigjs/hedwig/commit/b8b59a473d2a6b5f3a209561445381fd77b3592c) Thanks [@pipinov](https://github.com/pipinov)! - New packages. `@hedwigjs/react`: `useClient`, `useTopic`, `useStateTopic`,
  `useRequest`, `useRemoteClient`, `useRuntimeReady` — hooks that bind
  Hedwig clients to the component lifecycle (StrictMode-safe creation in a
  layout effect, retained state before the first paint, `pending` / `result`
  for requests, a remote client that lives as long as its options do).
  `@hedwigjs/vue`: the same surface as Vue 3 composables released with the
  scope. Both build on `@hedwigjs/client` only.

### Patch Changes

- Updated dependencies [[`09d194b`](https://github.com/hedwigjs/hedwig/commit/09d194b4a951206ca0d5d0dd634d227f75212b22), [`7b1888e`](https://github.com/hedwigjs/hedwig/commit/7b1888e95f654cb6076011c83abd6e162abf9913), [`2643013`](https://github.com/hedwigjs/hedwig/commit/2643013093319fb93332dff6e49d6c36f718bb1d)]:
  - @hedwigjs/client@0.2.0
