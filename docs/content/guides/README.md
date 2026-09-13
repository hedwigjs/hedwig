# Guides

How-to articles for common patterns. Grow organically as we hit them.

## Written

- [`contract-based-topics.md`](./contract-based-topics.md) — topic kinds
  (`event` / `request` / `state`) in the contracts registry, `retention`,
  what the generator produces, kind-aware clients, retained state,
  versioning.
- [`bring-your-own-contracts.md`](./bring-your-own-contracts.md) — six
  patterns for producing `Topic` + `TopicPayloads` (and `TopicContracts`):
  starter kit, hand-written, Zod, Protobuf, codegen tools, mixed.
  Establishes that the registry is a pattern, not a mandate.

## Documented next to the code

Some subjects live in the package READMEs and the spec rather than here:

- **Remote clients and transports** — WebSocket, SSE, postMessage,
  BroadcastChannel, MessagePort, custom transports, identity modes,
  `accepts` / `forward`:
  [`packages/broker/README.md` § Remote clients](../../../packages/broker/README.md#remote-clients)
  and [§ Custom transports](../../../packages/broker/README.md#custom-transports).
- **The runtime / SDK split** — why a module depends on `@hedwigjs/client`
  and never on the runtime, and why boot order does not matter:
  [`packages/client/README.md`](../../../packages/client/README.md#why-a-separate-package).
- **React and Vue adapters** — `useClient`, `useTopic`, `useStateTopic`,
  `useRequest`, `useRemoteClient`, `useRuntimeReady`, and `bindHooks` /
  `bindComposables`: [`packages/react/README.md`](../../../packages/react/README.md),
  [`packages/vue/README.md`](../../../packages/vue/README.md).
- **The wire** — envelope, delivery semantics, threat model, support
  matrix; what a backend in any language needs:
  [`docs/content/spec/`](../spec/README.md).
- **The reference stand** — modules and client ids, ports, ACL, DevTools,
  e2e, deployment, what each part demonstrates:
  [`examples/advanced/README.md`](../../../examples/advanced/README.md).

## Retired

- [`demo-architecture.md`](./demo-architecture.md) — described the stand
  before `@hedwigjs/broker` existed (the mock-bus era). Kept so old links
  resolve; read `examples/advanced/README.md` instead.

## Planned

- `cross-realm-singleton.md` — why `window`-parked store, MF caveats.
- `sot-and-projections.md` — single source of truth vs read-only projection
  vs local React state — how to decide.
- `headless-controllers.md` — MFE that renders nothing, only orchestrates.
