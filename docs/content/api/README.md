# API Reference

Each package documents its public API in its own README; this page is the
index. Anything that crosses a process boundary is specified under
[`docs/content/spec/`](../spec/README.md), not here.

| Package | What it covers | Docs |
| --- | --- | --- |
| `@hedwigjs/client` | SDK for modules: `createClient`, `createRemoteClient`, `whenRuntimeReady`, `hasCapability`, `getRuntimeInfo`, the runtime handle, SDK errors, every module-visible type | [`packages/client/README.md`](../../../packages/client/README.md) |
| `@hedwigjs/broker` | The runtime: `initBroker` / `getBroker` / `createRemoteClient`, hooks, topic kinds and retention, remote clients and transports, wire format, system events, inspector. Subpaths: `@hedwigjs/broker/conformance` (transport conformance kit) and `@hedwigjs/broker/spec/envelope-v1.schema.json` (JSON Schema of the wire frame) | [`packages/broker/README.md`](../../../packages/broker/README.md) |
| `@hedwigjs/devtools` | The `MessageBrokerDevTools` component and its props | [`packages/devtools/README.md`](../../../packages/devtools/README.md) |
| `@hedwigjs/react` | `useClient`, `useTopic`, `useStateTopic`, `useRequest`, `useRemoteClient`, `useRuntimeReady`, `bindHooks` | [`packages/react/README.md`](../../../packages/react/README.md) |
| `@hedwigjs/vue` | The same surface as Vue 3 composables, plus `bindComposables` | [`packages/vue/README.md`](../../../packages/vue/README.md) |
| `@hedwigjs/create-registry` | `npm create @hedwigjs/registry`: the contract shape (`kind`, payload, `response`, `retention`) and the generated `Topic`, `TopicPayloads`, `TopicContracts`, `TOPIC_KINDS` | [`packages/create-registry/README.md`](../../../packages/create-registry/README.md) |

Specifications:

- [`spec/envelope-v1.md`](../spec/envelope-v1.md) — the wire frame: fields, kinds, ids, evolution rules
- [`spec/delivery-semantics.md`](../spec/delivery-semantics.md) — what `emit` and `request` promise across a wire
- [`spec/threat-model.md`](../spec/threat-model.md) — trust boundaries per transport, what the runtime enforces
- [`spec/support-matrix.md`](../spec/support-matrix.md) — transports × capabilities × environments
