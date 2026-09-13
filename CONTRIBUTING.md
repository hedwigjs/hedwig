# Contributing to Hedwig

## Requirements

- Node.js 22 (`.nvmrc`; ≥ 18.17 works), npm 9+.
- `npm install` at the root installs every workspace.

## Layout

- `packages/client` — the SDK modules use (`createClient`, types). No runtime dependency.
- `packages/broker` — the runtime (host only). Depends on the SDK for types.
- `packages/devtools` — React DevTools panel (host only).
- `packages/react`, `packages/vue` — adapters on top of the SDK.
- `packages/create-registry` — `npm create @hedwigjs/registry` scaffolder.
- `examples/advanced` — the reference stand (shell, 7 MFEs, backend, contracts, e2e).
- `docs/content` — spec (normative), RFCs, guides.

## Everyday commands (repo root)

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the public packages in dependency order: client → broker → devtools → react → vue. Run after pulling; the demo and the tests consume `dist/`. |
| `npm run typecheck` | `tsc --noEmit` in every workspace, packages and demo apps alike. |
| `npm test` | Unit suites: client, broker, devtools, react, vue, and the demo backend's schema tests. Also renders the built DevTools panel under React 18 (`packages/devtools/react18-smoke`, a standalone project with its own lockfile — run `npm run build -w @hedwigjs/devtools` first). |
| `npm run e2e` | Playwright against the reference stand. Boots the stand itself; needs `npx playwright install chromium` once. |
| `npm run dev:demo` | The stand at http://localhost:3000 (shell), MFEs on 3001–3006, backend on 4000. |

## Making a change

1. Branch from `main`.
2. Change code and tests together. Wire-facing changes must keep the spec
   (`docs/content/spec/envelope-v1.md`), the JSON Schema
   (`packages/broker/spec/envelope-v1.schema.json`) and `parseFrame` in
   agreement — the broker suite proves the last two agree on a corpus.
3. Contract changes: edit `examples/advanced/shared/contracts/src/domains/**`
   and run `npm run build -w @hedwig-demo/contracts`; commit the regenerated
   `index.generated.ts` (CI checks it is not stale).
4. Add a changeset for every touched public package: `npx changeset`
   (patch / minor / major + a paragraph in plain language). Demo workspaces
   need none.
5. Update the docs that describe the behaviour you changed: package
   README, spec, guides, `CHANGELOG.md` (project-level milestones).
6. Open a PR; the template is the checklist. CI runs build, typecheck,
   unit tests, the stand end to end, and the changeset check.

## Versioning and releases

- Changesets drive versions. Merging to `main` with pending changesets
  opens a "Version Packages" PR; merging that PR publishes to npm with
  provenance attestations (Sigstore, via GitHub OIDC).
- The runtime and the SDK follow semver independently. Before 1.0, copies
  of the runtime must share the same minor to share a realm; the SDK's
  `MIN_RUNTIME` names the oldest runtime its types match and is bumped in
  lockstep with runtime releases that extend the ABI-1 surface.
- The wire format has its own version (`v`), see the spec.

## Design changes

Anything that changes a public API or constrains future choices gets a
short RFC in `docs/content/rfcs/` before the code. See the index there.

## Code of conduct

Be kind, be specific, assume good faith. Report security issues per
`SECURITY.md`, not in public issues.
