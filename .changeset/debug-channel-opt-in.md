---
"@hedwigjs/broker": minor
"@hedwigjs/devtools": patch
---

`broker.$debug.send` is now opt-in. Boot the broker with
`initBroker({ debug: true })` to arm the channel; without it `send()`
resolves `NACK DEBUG_DISABLED` without entering the pipeline and logs
`debug.disabled`. `$debug.enabled` exposes the state. Off by default so
a production bundle cannot inject spoofed-source messages by accident
(the DevTools Debug tab, integration tests and nothing else use this
channel). This is accident prevention, not a security boundary.

DevTools: the Debug tab shows an explanatory "channel is off" notice
with the one-line fix instead of a composer that only produces NACKs.
