# Guides

How-to articles for common patterns. Grow organically as we hit them.

## Written

- [`bring-your-own-contracts.md`](./bring-your-own-contracts.md) — five
  patterns for producing `Topic` + `TopicPayloads` for broker: starter kit,
  hand-written, Zod, Protobuf, codegen tools, mixed. Establishes that
  registry is a pattern, not a mandate.
- [`demo-architecture.md`](./demo-architecture.md) — annotated tour of
  `examples/advanced/`.

## Planned

- `contract-based-topics.md` — TopicMap, versioning, breaking-change strategy.
- `cross-realm-singleton.md` — why `window`-parked store, MF caveats.
- `sot-and-projections.md` — single source of truth vs read-only projection
  vs local React state — how to decide.
- `headless-controllers.md` — MFE that renders nothing, only orchestrates.
- `writing-adapters.md` — turning a raw WS/SSE/postMessage source into typed
  bus events. Companion to RFC-0001.
