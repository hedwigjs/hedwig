# packages/

Publishable `@hedwigjs/*` packages live here. Each subdirectory is an npm
workspace with its own `package.json`, `tsconfig.json`, and build output.

## Core

The packages that make up Hedwig itself — what users install to build on
Hedwig.

| Directory   | npm name             | Role                                                                                                | Status                  |
| ----------- | -------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `broker/`   | `@hedwigjs/broker`   | Runtime broker + observability primitives. Ships the built-in bridges for postMessage / BroadcastChannel / WebSocket / SSE. | Ported (0.1.0, private) |
| `devtools/` | `@hedwigjs/devtools` | React panel: message timeline, clients, bridges, replay buffer, system events.                       | Ported (0.1.0, private) |

## Starter kits (optional)

Convenience tooling around the core. Not required to use Hedwig.

| Directory          | npm name                    | Role                                                                                                                                                                                                                                       | Status                  |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `create-registry/` | `@hedwigjs/create-registry` | Initializer CLI (`npm create @hedwigjs/registry`) that scaffolds an opinionated topic-registry package for TS-first greenfield projects. Optional — broker accepts topic types from any source (Zod, Protobuf, GraphQL, hand-written, mixed). | Ported (0.1.0, private) |

See [`docs/content/guides/bring-your-own-contracts.md`](../docs/content/guides/bring-your-own-contracts.md)
for alternatives.

## Roadmap — separate adapter packages

Today every transport ships inside `@hedwigjs/broker` and plugs into the
core via the `BridgeTransport` interface (three methods: `send`,
`onMessage`, `destroy`). That layout is deliberate for the pre-release —
the interface is still stabilising and one `npm i @hedwigjs/broker`
gets a user everything.

Once the transport contract is stable, individual transports move into
standalone `@hedwigjs/adapter-*` packages so users pull in only what they
need and community authors can publish their own without forking core.
Design lives in
[`docs/content/rfcs/0001-transport-adapters.md`](../docs/content/rfcs/0001-transport-adapters.md).
