---
"@hedwigjs/broker": minor
---

Wire envelope v1. Every frame that crosses a transport now follows one
spec (`docs/content/spec/envelope-v1.md`) with a JSON Schema shipped as
`@hedwigjs/broker/spec/envelope-v1.schema.json`: `v`, `id`, `origin`,
`kind` (`event` | `request` | `response`), `topic`, `source`, `target`,
`data`, `timestamp`, optional `correlationId`, `deadline`, `ext`. Outbound
frames are built from the message with this realm's session id as
`origin`; inbound frames pass a structural check equivalent to the schema
(proved by test), a `v` / `kind` support check (`UNSUPPORTED`) and an echo
guard (`ECHO` when `origin` is our own). The producer's id lands on the
message as `wireId`, the `ext` block as `ext`; `ext.hedwig.claimedSource`
records what a fixed-identity peer claimed. `parseFrame`, `buildFrame`,
`WIRE_VERSION` and the wire types are exported. Missing `v` / `kind` stay
tolerated for one wire version.
