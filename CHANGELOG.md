# Changelog

Project-level milestones for Hedwig. Per-package release notes are
maintained by [Changesets](./.changeset/README.md) and end up in each
package's own `CHANGELOG.md` on version bump — see
[`packages/broker/CHANGELOG.md`](./packages/broker/CHANGELOG.md),
[`packages/devtools/CHANGELOG.md`](./packages/devtools/CHANGELOG.md),
[`packages/create-registry/CHANGELOG.md`](./packages/create-registry/CHANGELOG.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Reference stand

- Bilingual UI (EN default, RU toggle). Backend AI replies + notification
  bodies + checkout iframe HTML all honour `?lang=` from the client.
- Whole stand now served under `/demo/advanced/` on the production
  domain — root `/` 302-redirects there.
- Late-mount MFE card demonstrates history-buffer replay against a
  live producer.
- Analytics MFE surfaces the ACL rejection channel
  (`subscription.rejected` + `message.rejected` in DevTools).
- Cart mutations moved to CQRS style — targeted `request()` to the
  cart runtime with typed `RoutingResult.data`.
- Mobile-safe modal scroll lock — nested modals (cart popup + checkout
  iframe + menu item modal) cooperate on a shared reference counter
  and use `position: fixed` + saved `scrollY` so iOS Safari doesn't
  leave the page stuck after close.
- Header no longer shows a non-functional user avatar; language toggle
  lives in its place.

### Infrastructure

- Deployed to a Yandex Cloud VM with HTTPS (Let's Encrypt via certbot).
  Live URL: [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced).
- GitHub Actions **Deploy reference stand** rebuilds shell + every MFE
  with prod URLs baked in, rsyncs to the VM, diff-syncs the nginx
  config, restarts the backend only when its fingerprint actually
  changed, then runs a curl smoke test.
- GitHub Actions **Release** wired to Changesets — opens the Version
  Packages PR automatically and publishes to npm on merge (requires
  `NPM_TOKEN` secret with `@hedwigjs` write + bypass 2FA).

### Docs

- Every `@hedwigjs/*` package README rewritten reference-library style
  (compact API tables, recipes, table of contents).
- New [`examples/advanced/README.md`](./examples/advanced/README.md) —
  authoritative overview of the reference stand.
- Head README gained the Live demo callout, up-to-date `What ships`
  table, and a Deployment section pointing at the workflow +
  versioned nginx config.
- Hardcoded version numbers stripped from docs — `package.json` stays
  the single source of truth so docs don't drift on every bump.
- Empty `scripts/` and `tooling/` placeholder dirs removed.

## [0.1.0] — 2026-08-29

Initial npm publish under the [`@hedwigjs`](https://www.npmjs.com/org/hedwigjs) org:

- **[`@hedwigjs/broker`](https://www.npmjs.com/package/@hedwigjs/broker)** — runtime broker.
  - Two message semantics: `emit()` (fan-out event) + `request()`
    (targeted call with typed response).
  - Four built-in transports: PostMessage, BroadcastChannel,
    WebSocket, SSE. Custom transports plug in via the 3-method
    `BridgeTransport` interface.
  - Hooks (`beforeSend`, `afterSend`, `onSubscribe`) for ACL, metrics,
    tracing, validation. `subscription.rejected` and
    `message.rejected` surface hook-driven denials as first-class
    system events.
  - Message history + opt-in `replay` for late subscribers.
  - Backpressure strategies (throttle, debounce, rate limit).
  - Observability surface: `broker.$systemEvents` (push) +
    `broker.inspect` (pull) + `broker.$debug.send()` (synthetic
    injection).
  - Structured logger (`BrokerLogger`) with stable event codes.
  - 15-scenario tinybench harness under
    [`packages/broker/benchmarks/`](./packages/broker/benchmarks/).
- **[`@hedwigjs/devtools`](https://www.npmjs.com/package/@hedwigjs/devtools)** — React DevTools panel.
  - Six tabs: Messages (with rollup for high-frequency bursts),
    Clients, Bridges, Replay Buffer, System Events, Debug (compose +
    send synthetic messages via `$debug.send`).
  - Accepts any `Record<name, TopicContractInfo>` registry for
    autocomplete + example payload prefill.
  - Docks to any edge; layout persists per user in localStorage.
- **[`@hedwigjs/create-registry`](https://www.npmjs.com/package/@hedwigjs/create-registry)** — initializer CLI.
  - `npm create @hedwigjs/registry <dir>` scaffolds a standalone
    TypeScript topic-registry package with codegen, one-event-per-file
    layout, and generated `Topic` / `TopicPayloads` / `TOPICS` /
    `registry` exports.
  - Produced package has zero runtime dependency on `@hedwigjs/*`.
