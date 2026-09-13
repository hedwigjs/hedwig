---
"@hedwigjs/broker": minor
"@hedwigjs/devtools": patch
---

Bridges got a minimum safety floor. A `request()` no longer crosses a
bridge — only multicasts are forwarded — so a unicast to an unregistered
recipient is an honest `NACK NOT_SUBSCRIBED` instead of executing on the
far side while reporting failure here. Inbound frames are validated field
by field (`topic`, `source`, `target` non-empty strings, `data` present)
and dropped as `bridge.message.invalid { reason: 'MALFORMED' }` before
any hook runs. New `BridgeConfig.allowedSources` allow-lists the `source`
an inbound frame may claim; violations are dropped as
`SOURCE_NOT_ALLOWED`. Both drops are logged and published on
`$systemEvents`; DevTools shows them in the System Events tab.
