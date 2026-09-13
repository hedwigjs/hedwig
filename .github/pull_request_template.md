## What

<!-- One paragraph: what changes and why. Link the issue or RFC if any. -->

## Checklist

- [ ] `npm run build && npm run typecheck && npm test` pass locally
- [ ] `npm run e2e` passes when the reference stand or a runtime path changed
- [ ] A changeset exists for every touched public package (`npx changeset`), or this PR touches none
- [ ] Docs updated where behaviour changed (package README, `docs/content/spec/*`, guides)
- [ ] A contract change regenerated `index.generated.ts` (`npm run build -w @hedwig-demo/contracts`)
- [ ] Wire-facing change: the spec and `envelope-v1.schema.json` agree, and the backend test still passes

## Notes for the reviewer

<!-- Anything non-obvious: trade-offs, follow-ups, how you verified it. -->
