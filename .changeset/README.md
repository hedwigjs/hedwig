# Changesets

Version-bump & release workflow for the `@hedwigjs/*` packages
(`broker`, `devtools`, `create-registry`). Everything under
`@hedwig-demo/*` (the reference-stand workspaces) is ignored — those
are private and not published.

## Add a changeset before merging

Every PR that touches a public package should include a changeset
describing the intended version bump. From the repo root:

```
npx changeset
```

Interactive prompt:

1. Pick the package(s) affected (space to select, enter to confirm).
2. Choose bump type per package:
   - **patch** — bug fix, doc-only change, dep bump
   - **minor** — new feature, additive API
   - **major** — breaking change
3. Write a one-line summary. This lands in the CHANGELOG.

The command writes `.changeset/<generated-name>.md`. Commit it with
your PR — CI treats the file as a pending release.

## What CI does

On push to `main`, `.github/workflows/release.yml` runs. If there are
pending changesets, it opens (or updates) a **Version Packages** PR
that:

- Bumps each affected package's `version` field.
- Regenerates `CHANGELOG.md` per package.
- Removes the consumed `.changeset/*.md` files.

Merging that PR triggers a second run which detects the version bumps
and runs `npm publish` under the `@hedwigjs` org. `NPM_TOKEN` (a
granular access token with **Read and write** on `@hedwigjs` +
**Bypass 2FA**) must be present as a GitHub Secret.

## Manual release from local

Emergency path if CI is down:

```
npx changeset version    # applies pending changesets, bumps versions
npx changeset publish    # publishes bumped packages to npm
git push --follow-tags
```
