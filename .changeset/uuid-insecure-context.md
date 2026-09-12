---
"@hedwigjs/broker": patch
---

`initBroker()` no longer throws outside secure contexts. The session id
baked into every message id was generated with `crypto.randomUUID()`,
which browsers expose only on `https:` and `localhost` — on a plain
`http://` staging or intranet host the broker failed on its first line.
Generation now falls back to `crypto.getRandomValues()` and, as a last
resort, `Math.random()`, still producing RFC 4122 v4 ids.
