# Specifications

Normative documents for anything that crosses a process boundary. A
backend in Go, Python or Java needs nothing from npm to talk to a Hedwig
runtime: it produces and consumes frames that conform to these pages.

| Document | What it fixes |
| --- | --- |
| [`envelope-v1.md`](./envelope-v1.md) | The wire frame: fields, kinds, ids, the echo guard, evolution rules. JSON Schema: [`packages/broker/spec/envelope-v1.schema.json`](../../../packages/broker/spec/envelope-v1.schema.json), shipped as `@hedwigjs/broker/spec/envelope-v1.schema.json`. |
| [`delivery-semantics.md`](./delivery-semantics.md) | What `emit` and `request` promise across a wire: at-most-once, ordering, deduplication, what is never forwarded. |
| [`threat-model.md`](./threat-model.md) | Trust boundaries per transport, what the runtime enforces at ingress, what stays the application's job. |
| [`support-matrix.md`](./support-matrix.md) | Built-in transports × capabilities × environments, and which features are available over which wire. |

Conformance: the runtime's ingress check is *equivalent* to the schema —
`packages/broker/src/core/wire/envelope.test.ts` feeds one corpus of frames
to both and requires the same verdict. A producer is conformant when every
frame it emits validates against the schema; the demo backend pins that in
`examples/advanced/backend/src/envelope.test.ts`.

Versioning: the wire has its own `v`, independent of package versions. A
runtime accepts the versions it lists in its capabilities (`wire.v1`) and
tolerates a missing `v` for one version.
