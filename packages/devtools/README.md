# @hedwigjs/devtools

DevTools panel for `@hedwigjs/broker` — message flow, subscribers, and the
observability inspector.

Part of the Hedwig core: `@hedwigjs/broker` (runtime) +
`@hedwigjs/devtools` (this) + `@hedwigjs/adapter-*` (first-party transport
adapters, upcoming).

> Pre-release. API is being stabilized. Package is not yet published to npm.

## Install

Not published yet. Inside the Hedwig monorepo the package is consumed via npm
workspaces (`"@hedwigjs/devtools": "*"`). Uses `@hedwigjs/broker`,
`react`, and `react-dom` as peer dependencies.

## Overview

Hedwig broker emits a stable observability channel via `broker.$systemEvents`
(push) and `broker.inspect` (pull). `@hedwigjs/devtools` consumes both to
render a React panel that shows:

- **Messages log** — every emitted message with timestamps and payloads.
- **Clients log** — registered clients and their subscriptions.
- **Topics registry** — optional integration with a per-project registry
  to show topic descriptions and fixture payloads next to live messages.
  Accepts any `Record<string, TopicContractInfo>`; DevTools does not depend
  on a specific registry package. Common producers: `@hedwigjs/create-registry`
  starter, Zod schemas, hand-written manifests, or codegen from external
  contract sources.

The panel is a self-contained React component you mount wherever your dev
UI lives (inside the shell of a MFE app, in a dedicated `/dev` route,
inside a browser-extension host, etc.).

## Scripts

- `npm run build` — bundle to `dist/index.js` (CJS) via webpack + `.d.ts`
  via `tsc`.
- `npm test` — Jest suite (inspector unit tests).
- `npm run typecheck` — type-check without emit.

## License

MIT.
