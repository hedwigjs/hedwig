---
"@hedwigjs/broker": patch
---

Deterministic dispatch when handlers subscribe or unsubscribe mid-flight.
`Router.multicast` and the hook registry iterated live arrays; a handler
(or hook) that unsubscribed a sibling during delivery spliced the array
under the loop and silently skipped the next entry, while a client
subscribed during delivery received the in-flight message. Both now
iterate a snapshot taken before the first handler runs, with DOM
`EventTarget` semantics: a handler unsubscribed mid-dispatch is not
invoked (`off()` is immediate), a handler subscribed mid-dispatch starts
with the next message. Re-entrant `emit()` from inside a handler is
documented as inline delivery.
