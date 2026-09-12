---
"@hedwigjs/broker": patch
"@hedwigjs/devtools": patch
---

Fault isolation for bridges: a transport that throws from `send()` no
longer rejects the caller's `emit()` / `request()` after local delivery
already happened, and no longer starves the bridges registered after it.
The failure is reported per bridge as `bridge.send.failed` on both the
logger and `$systemEvents` (`{ bridgeId, topic, messageId, error }`).
DevTools surfaces it in the System Events tab with a distinct `failed`
badge.
