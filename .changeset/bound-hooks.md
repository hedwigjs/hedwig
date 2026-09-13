---
"@hedwigjs/react": minor
"@hedwigjs/vue": minor
---

`bindHooks(client)` (React) and `bindComposables(client)` (Vue): the
three data hooks — `useTopic`, `useStateTopic`, `useRequest` — with the
client already filled in, for modules that create one client at module
scope. `useStateTopic('cart.snapshot.v1')` instead of
`useStateTopic(bus, 'cart.snapshot.v1')`; types unchanged. The reference
stand's cart, menu and notifications MFEs use the bound form.
