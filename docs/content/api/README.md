# API Reference

Each package documents its public API in its own README; this page is the
index. Anything that crosses a process boundary is specified under
[`docs/content/spec/`](../spec/README.md), not here.

| Package | What it is | Docs |
| --- | --- | --- |
| `@hedwigjs/client` | The SDK a module depends on | [`packages/client/README.md`](../../../packages/client/README.md) |
| `@hedwigjs/broker` | The runtime a host boots (also `@hedwigjs/broker/conformance` and the wire schema at `spec/envelope-v1.schema.json`) | [`packages/broker/README.md`](../../../packages/broker/README.md) |
| `@hedwigjs/devtools` | The DevTools panel | [`packages/devtools/README.md`](../../../packages/devtools/README.md) |
| `@hedwigjs/react` | React hooks on the SDK | [`packages/react/README.md`](../../../packages/react/README.md) |
| `@hedwigjs/vue` | Vue 3 composables on the SDK | [`packages/vue/README.md`](../../../packages/vue/README.md) |
| `@hedwigjs/create-registry` | Scaffolds a contracts registry | [`packages/create-registry/README.md`](../../../packages/create-registry/README.md) |

The lists of exports live in those READMEs and in each package's `index.ts`; this page deliberately repeats none of them.

Specifications:

- [`spec/envelope-v1.md`](../spec/envelope-v1.md) — the wire frame: fields, kinds, ids, evolution rules
- [`spec/delivery-semantics.md`](../spec/delivery-semantics.md) — what `emit` and `request` promise across a wire
- [`spec/threat-model.md`](../spec/threat-model.md) — trust boundaries per transport, what the runtime enforces
- [`spec/support-matrix.md`](../spec/support-matrix.md) — transports × capabilities × environments
