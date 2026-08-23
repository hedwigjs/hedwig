# Changelog

All notable changes to Hedwig will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Repository scaffolding: `packages/`, `docs/`, `tooling/`, `scripts/` placeholders.
- Reference demo relocated to `examples/advanced/`.
- Root `package.json` scripts trimmed to monorepo-level (`dev:demo`, `stop:demo`,
  `restart:demo`); demo-specific orchestration moved to
  `examples/advanced/package.json`.
- Demo topics split by domain in `shared/contracts/src/domains/*.ts`, composed
  into `TopicMap` in `topics.ts`.
- `docs/content/rfcs/0001-transport-adapters.md` — draft RFC for transport
  adapters (dropped plan for a `@hedwigjs/node` package).
- `docs/content/rfcs/0002-demo-audit-2026-08.md` — audit note on the
  reference stand ahead of the broker migration.
- `docs/content/guides/demo-architecture.md` — annotated tour of the
  reference stand.
- `packages/broker@0.1.0` (private, name `@hedwigjs/broker`) — port of
  `@message-broker/core` from `/Users/alexpipinov/hse/shared/mfe/message-broker`.
  Source, tests, tsup + jest configs copied verbatim; brand references
  renamed (`@message-broker/core` → `@hedwigjs/broker`, `@hse/topics-registry`
  → `@hedwigjs/registry` in JSDoc). Build + full test suite (16 suites, 335
  tests) pass. Not wired into the demo yet.
- `packages/broker/benchmarks-legacy/` — origin benchmarks archived; they rely
  on internal per-file dist paths and an obsolete `InMemoryClient` name.
  To be rewritten against the public API in a later pass.
- `packages/devtools@0.1.0` (private, `@hedwigjs/devtools`) — React DevTools
  port from `@message-broker/dev-tools`. Brand references renamed
  (`@message-broker/core` → `@hedwigjs/broker`, `@message-broker/dev-tools` →
  `@hedwigjs/devtools`), peer-deps set to `@hedwigjs/broker@^0.1.0` +
  React 19. Build via webpack + tsc (dts). 13/13 tests pass. Not wired into
  the demo yet.
- `packages/create-registry@0.1.0` (private, `@hedwigjs/create-registry`) —
  CLI initializer port from `@message-broker/create-registry`. `templates/`
  copied verbatim; brand references renamed inside CLI + templates.
  Standalone package — creates registry workspaces with zero runtime
  dependency on `@hedwigjs/*`. Build via tsc. No tests (origin had none).
- Legacy `@event-broker/devtools` (v2.0.0) from hse — **NOT** ported;
  superseded by the v0.1.0 `@message-broker/dev-tools` line we took.
- `@hse/topics-registry` from hse — **NOT** ported; it's the *output* of
  `create-registry`, not a publishable package (analog of the demo's own
  `@hedwig-demo/contracts`).
- Repositioning: registry acknowledged as a **pattern**, not a Hedwig
  product. Core is now broker + devtools + adapters; `create-registry` is
  labelled an **optional starter kit** for TS-first greenfield teams.
  Root and package READMEs updated, `docs/content/guides/bring-your-own-contracts.md`
  added showing five equal alternatives (starter, hand-written, Zod,
  Protobuf, GraphQL/AsyncAPI/OpenAPI codegen, mixed). Broker's core public
  API (`Client<T, P>`) is unchanged — it accepts topic types from any
  source; only positioning and docs were adjusted.
- `examples/advanced/shared/contracts/` — migrated from hand-written
  domain files to a real `@hedwigjs/create-registry`-scaffolded workspace.
  16 events now live one-per-file under `src/domains/<domain>/<action>.v<N>.ts`
  with `description`, typed `payload`, and `examples` fixtures. Codegen
  (`scripts/build.mjs`) produces `src/index.generated.ts` with `registry`,
  `Topic`, `TopicPayloads`, `TOPICS` — the file **is** committed for
  workspace ergonomics (template's `.gitignore` line dropped) so fresh
  clones don't require a codegen run before typecheck.
- Topic names normalised: action segments were `dot.separated` in the old
  hand-written map, now `dash-separated` per codegen convention
  (`cart.item.added.v1` → `cart.item-added.v1`, `chat.reply.chunk.v1` →
  `chat.reply-chunk.v1`, `ui.menu-item.opened.v1` → `ui.menu-item-opened.v1`;
  `cart.snapshot.v1`, `checkout.completed.v1`, `notification.show.v1`
  unchanged). All MFEs, mock-bus, and comments updated accordingly.
- Type API in `@hedwig-demo/contracts` renamed to match generated shape:
  `TopicMap` → `TopicPayloads`, `TopicName` → `Topic`. Cross-cutting
  domain types (`CartItem`, `MenuItem`, `MenuNutrition`, `NotificationKind`)
  moved to `src/shared-types.ts` inside the same contracts package — not
  a separate workspace, kept co-located because they support event
  payloads and MFE UI code alike.
- `menuMock` (12-dish demo fixture) moved from `contracts` to
  `mfe/storefront/src/data.ts` — it belongs with its only consumer, not
  in the shared topic registry.
- `examples/advanced/package.json` gained `predev` hook that runs
  `build -w @hedwig-demo/contracts` first (codegen produces
  `index.generated.ts` before any MFE tries to import from contracts).
  New `dev:contracts` runs the watch-mode codegen concurrently with the
  rest of the stand.

_No packages published yet._
