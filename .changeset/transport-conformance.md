---
"@hedwigjs/broker": minor
---

`@hedwigjs/broker/conformance`: a framework-agnostic list of checks every
`Transport` must pass (`transportConformance(factory)` → `{ name, run }`
cases; `createMemoryTransportPair()` as the reference pair). The built-in
MessagePort, BroadcastChannel and WebSocket transports run it in the
package's own suite.
