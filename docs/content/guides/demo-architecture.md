# The `examples/advanced/` reference stand — architecture (retired)

This page described the stand as it was before `@hedwigjs/broker`
existed: an in-tree `mock-bus`, a `storefront` MFE, hand-rolled
WebSocket / SSE / postMessage bridges and `{ replay: true }` on
subscribe. None of that is in the code any more, so the page was
retired rather than kept half-right. It stays here so old links resolve.

Read instead:

- [`examples/advanced/README.md`](../../../examples/advanced/README.md) —
  the current stand: modules and client ids, ports, remote clients over
  WebSocket / SSE / postMessage / BroadcastChannel, the ACL, DevTools,
  the e2e suite, deployment, and what each part demonstrates.
- [`contract-based-topics.md`](./contract-based-topics.md) — the topic
  model the stand runs on: `event` / `request` / `state`, `retention`,
  `initBroker({ topics: TOPIC_KINDS })`, kind-aware clients.

The audit that led to the rewrite is
[RFC 0002](../rfcs/0002-demo-audit-2026-08.md).
