---
"@hedwigjs/broker": minor
"@hedwigjs/devtools": patch
---

History records every multicast event once `history.enabled` is set in
`initBroker`; the per-message `history: true` flag is no longer needed
(it is still accepted). `history: false` keeps a single message out of
the buffer. Requests and frames from remote clients are not recorded, as
before. Reason: a buffer that stays empty unless every emit site
remembers a flag surprised people — the DevTools Replay Buffer tab was
always empty on a stand with history enabled. The tab's empty-state hint
now describes the new rule.
