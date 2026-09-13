# packages/

Publishable `@hedwigjs/*` packages live here. Each subdirectory is an npm
workspace with its own `package.json`, `tsconfig.json`, and build output.

## Core

The packages that make up Hedwig itself — what users install to build on
Hedwig. Modules depend on the SDK (or a framework binding on top of it);
only the host depends on the runtime.

| Directory   | npm name             | Role                                                                                                | Status                  |
| ----------- | -------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `client/`   | `@hedwigjs/client`   | SDK for modules: `createClient`, `createRemoteClient`, `whenRuntimeReady`, `hasCapability`, `getRuntimeInfo`, all module-visible types. No runtime dependency; locates the host's runtime via `Symbol.for('@hedwigjs/runtime/1')` and hands out a lazy client until it appears. | Unreleased (0.1.0) |
| `react/`    | `@hedwigjs/react`    | React 18 / 19 hooks on the SDK: `useClient`, `useTopic`, `useStateTopic`, `useRequest`, `useRemoteClient`, `useRuntimeReady`, `bindHooks`. | Unreleased (0.1.0) |
| `vue/`      | `@hedwigjs/vue`      | Vue 3 composables with the same surface, plus `bindComposables`. | Unreleased (0.1.0) |
| `broker/`   | `@hedwigjs/broker`   | The runtime: `initBroker`, `getBroker`, `createRemoteClient`, hooks, per-topic retention, backpressure, system events, inspector. Remote clients over the built-in transports (`postmessage`, `message-port`, `broadcast-channel`, `websocket`, `sse`) or a custom `Transport`. Ships the wire envelope v1 JSON Schema (`@hedwigjs/broker/spec/envelope-v1.schema.json`) and the transport conformance kit (`@hedwigjs/broker/conformance`). | Published (0.1.1) |
| `devtools/` | `@hedwigjs/devtools` | React panel (React 18.2 / 19): message timeline, clients (local and remote), replay buffer, system events. | Published (0.1.1) |

## Starter kits (optional)

Convenience tooling around the core. Not required to use Hedwig.

| Directory          | npm name                    | Role                                                                                                                                                                                                                                       | Status                  |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `create-registry/` | `@hedwigjs/create-registry` | Initializer CLI (`npm create @hedwigjs/registry`) that scaffolds an opinionated topic-registry package: one contract file per topic (`kind` — `event`, `request` or `state` — payload, `response`, `retention`) and codegen for `Topic`, `TopicPayloads`, `TopicContracts` and `TOPIC_KINDS`. Optional — the broker accepts topic types from any source (Zod, Protobuf, GraphQL, hand-written, mixed). | Published (0.1.1) |

See [`docs/content/guides/bring-your-own-contracts.md`](../docs/content/guides/bring-your-own-contracts.md)
for alternatives.

## Transports

Every built-in transport ships inside `@hedwigjs/broker` and is named by
a descriptor (`{ kind: 'websocket', socket }`). The runtime instantiates
it, so transport code never lands in a module's bundle. A custom
transport implements the `Transport` interface (`send`, `onMessage`,
`destroy`, plus optional `duplex` / `fanout` / `ready` / `onClose`) and
is checked with `@hedwigjs/broker/conformance`. Separate
`@hedwigjs/adapter-*` packages were considered in
[RFC 0001](../docs/content/rfcs/0001-transport-adapters.md) and are not
planned; the current design is
[RFC 0003](../docs/content/rfcs/0003-participants-runtime-sdk.md).
