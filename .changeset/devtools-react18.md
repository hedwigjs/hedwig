---
"@hedwigjs/devtools": minor
---

The panel now runs on React 18.2+ as well as React 19 (peer range
`^18.2.0 || ^19.0.0`). The bundle used to inline `react/jsx-runtime`
from the React installed at build time (19), so a React 18 host failed
at first render with `Cannot read properties of null (reading
'useMemo')`; every `react/*` and `react-dom/*` request is now external
and resolves to the host's copy. A standalone smoke project renders the
built bundle under React 18.3 in CI to keep it that way.
