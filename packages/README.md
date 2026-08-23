# packages/

Publishable `@hedwigjs/*` packages live here. Each subdirectory is an npm
workspace with its own `package.json`, `tsconfig.json`, and build output.

## Core

The three packages that make up the Hedwig product itself. These are what
users install to build on Hedwig.

| Directory              | npm name                        | Role                                                              | Status |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------- | --- |
| `broker/`              | `@hedwigjs/broker`              | Runtime broker. Unified transport API + observability primitives. | Ported (0.1.0, private) |
| `devtools/`            | `@hedwigjs/devtools`            | React panel: message timeline, clients, topics-registry view.     | Ported (0.1.0, private) |
| `adapter-websocket/`   | `@hedwigjs/adapter-websocket`   | First-party WS transport adapter.                                 | Planned |
| `adapter-sse/`         | `@hedwigjs/adapter-sse`         | First-party SSE (EventSource) adapter.                            | Planned |
| `adapter-postmessage/` | `@hedwigjs/adapter-postmessage` | First-party `postMessage` adapter for iframe / worker.            | Planned |
| `adapter-cloudevents/` | `@hedwigjs/adapter-cloudevents` | CNCF CloudEvents envelope adapter.                                | Planned |

Adapter design is documented in
[`docs/content/rfcs/0001-transport-adapters.md`](../docs/content/rfcs/0001-transport-adapters.md).

## Starter kits (optional)

Convenience tooling around the core. Not required to use Hedwig.

| Directory              | npm name                        | Role                                                              | Status |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------- | --- |
| `create-registry/`     | `@hedwigjs/create-registry`     | Initializer CLI (`npm create @hedwigjs/registry`) that scaffolds an opinionated topic-registry package for TS-first greenfield projects. Optional — broker accepts topic types from any source (Zod, Protobuf, GraphQL, hand-written, mixed). | Ported (0.1.0, private) |

See [`docs/content/guides/bring-your-own-contracts.md`](../docs/content/guides/bring-your-own-contracts.md)
for alternatives.
