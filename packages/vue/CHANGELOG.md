# @hedwigjs/vue

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
