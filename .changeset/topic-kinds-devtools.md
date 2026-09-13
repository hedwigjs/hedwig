---
"@hedwigjs/devtools": patch
---

Messages show the topic's kind from the registry (`event` / `request` /
`state`) instead of multicast / unicast when the contract declares it, a
state topic's initial delivery carries a `retained` pill, and
`state.retained` appears in System Events.
