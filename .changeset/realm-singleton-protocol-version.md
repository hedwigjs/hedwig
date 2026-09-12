---
"@hedwigjs/broker": patch
"@hedwigjs/devtools": patch
---

One broker per realm, even when the library is bundled more than once.
The instance now lives in a non-enumerable registry on `globalThis`
(`Symbol.for('@hedwigjs/broker')`) keyed by the new exported
`PROTOCOL_VERSION`, so copies of `@hedwigjs/broker` that reach the page
through Module Federation without `singleton: true`, through two
bundlers, or through the ESM + CJS dual-package hazard all resolve to
the same broker. A second copy is reported once as
`broker.duplicate_copy`; a copy speaking a different protocol version
gets its own broker and a `broker.protocol_mismatch` warning instead of
a silent crash. `broker.protocolVersion` and
`inspect.getProtocolInfo()` expose the diagnostics. Iframes and Workers
are separate realms: they keep their own broker plus a bridge.

DevTools performs a protocol handshake on attach and shows a header
badge when the core's `PROTOCOL_VERSION` differs from the one the panel
was built against; both new events appear in the System Events tab,
hydrated from the snapshot for duplicates detected before the panel
mounted.
