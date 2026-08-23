# tooling/

Internal, non-publishable dev configs shared across `packages/*`. Each
subdirectory is a private npm workspace consumed by other workspaces via
`"devDependencies": { "@hedwigjs/tsconfig": "workspace:*" }` (or npm's
equivalent).

## Planned layout

| Directory        | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `tsconfig/`      | Base/lib/react TypeScript presets.                      |
| `eslint-config/` | Shared ESLint config for `packages/*` and `examples/*`. |
| `build/`         | Shared `tsup`/`unbuild` config helpers.                 |

Nothing here yet — will be introduced when the second `packages/*` workspace
appears and duplication starts hurting.
