---
"@hedwigjs/react": minor
"@hedwigjs/vue": minor
---

New packages. `@hedwigjs/react`: `useClient`, `useTopic`, `useStateTopic`,
`useRequest`, `useRemoteClient`, `useRuntimeReady` — hooks that bind
Hedwig clients to the component lifecycle (StrictMode-safe creation in a
layout effect, retained state before the first paint, `pending` / `result`
for requests, a remote client that lives as long as its options do).
`@hedwigjs/vue`: the same surface as Vue 3 composables released with the
scope. Both build on `@hedwigjs/client` only.
