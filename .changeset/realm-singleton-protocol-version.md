---
"@hedwigjs/broker": patch
"@hedwigjs/devtools": patch
---

One broker per realm, even when the library is bundled more than once.
The instance now lives in a non-enumerable slot on `globalThis`
(`Symbol.for('@hedwigjs/broker')`) together with the package version of
the copy that created it, so copies of `@hedwigjs/broker` that reach the
page through Module Federation without `singleton: true`, through two
bundlers, or through the ESM + CJS dual-package hazard all resolve to
the same broker. A compatible second copy (same minor before 1.0, same
major after) is reported once as `broker.duplicate_copy`; an
incompatible copy throws from `initBroker` / `getBroker` /
`createClient` with both versions in the message and never creates a
second bus. `VERSION`, `isCompatibleVersion`, `broker.version` and
`inspect.getVersionInfo()` expose the diagnostics. Iframes and Workers
are separate realms: they keep their own broker plus a bridge.

DevTools performs a version handshake on attach and shows a header
badge when the core's version is incompatible with the one the panel
was built against; `broker.duplicate_copy` appears in the System Events
tab, hydrated from the snapshot for duplicates detected before the panel
mounted.
