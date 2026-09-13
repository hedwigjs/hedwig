---
"@hedwigjs/devtools": minor
---

Remote clients in the panel: the Clients tab lists them with a
`remote · <transport>` badge and a detail view (transport, identity mode,
requests, `accepts`, forwarded topics; counters keyed by `via` and by
forwarded multicasts), the Messages tab shows `via <remote>` instead of
`external`, and the System Events tab renders `remote.created`,
`remote.destroyed`, `remote.frame.rejected` and `remote.send.failed`.
