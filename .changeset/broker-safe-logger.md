---
"@hedwigjs/broker": patch
---

Fault isolation: a throwing custom `logger` no longer takes the pipeline
down. Every internal `logger.warn` / `logger.error` call is now wrapped —
if the user-supplied sink throws (Sentry offline, serializer choked, …),
the failure is reported once to `console.error` as `logger.failed` and
`emit()` / `request()` resolve normally instead of rejecting.
