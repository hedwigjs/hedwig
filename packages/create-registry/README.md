# @hedwigjs/create-registry

Optional starter kit. Scaffolds an opinionated topics-registry
workspace for `@hedwigjs/broker` — a codegen-driven TypeScript package
where each topic lives in its own file and the types the runtime and
the SDK expect (`Topic`, `TopicPayloads`, `TopicContracts`, `TOPICS`,
`TOPIC_KINDS`, `registry`, …) are generated for you.

```bash
npm create @hedwigjs/registry my-topics
```

> `@hedwigjs/broker` accepts topics from **any source** — Zod,
> Protobuf, GraphQL, a hand-written `TopicMap`, or a mix. This package
> is a convenience layer for teams starting fresh in TypeScript. If
> you already have a contracts pipeline, keep it — see
> [Bring your own contracts](../../docs/content/guides/bring-your-own-contracts.md).

> Pre-release.

**Live demo →** [hedwigjs.com/demo/advanced](https://hedwigjs.com/demo/advanced) · **Full project docs →** [`../..#readme`](../..#readme)

---

## Table of contents

- [What it does](#what-it-does)
- [Usage](#usage)
- [What gets generated](#what-gets-generated)
- [The contract shape](#the-contract-shape)
- [Generated exports](#generated-exports)
- [Using the registry in your app](#using-the-registry-in-your-app)
- [Adding a topic](#adding-a-topic)
- [Versioning workflow](#versioning-workflow)
- [When to use — and when not to](#when-to-use--and-when-not-to)
- [License](#license)

---

## What it does

Running the initializer creates a standalone TypeScript package with:

- A file convention: one topic per file at `src/domains/<domain>/<action>.v<N>.ts`.
- A small `TopicContract` type. Every topic is an `event`, a `request`
  (with a `response` type) or `state`; an event may declare `retention`.
- A codegen (`scripts/build.mjs`) that scans `src/domains/`, validates
  names and kinds, and writes `src/index.generated.ts` — a composed
  registry, the `Topic` / `TopicPayloads` / `TopicContracts` types
  `@hedwigjs/client` expects, the `TOPIC_KINDS` map the runtime
  expects, and a `TOPICS` constant map you can use to avoid string
  typos at call sites.
- A `README.md` for your team — this workflow, with your package name
  filled in.

The generated package has **no runtime dependency on `@hedwigjs/*`** —
it's a plain TS package that ships types and (optional) fixture
payloads. Consumers can be broker clients, custom pub/sub, tests, or
docs generators.

---

## Usage

```bash
npm create @hedwigjs/registry <directory> [options]
```

Interactive by default. Pre-supply flags to skip prompts.

| Flag                  | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `<directory>`         | Positional. Target directory for the new package.                    |
| `--name <name>`       | npm package name (e.g. `@my-org/topics`). Asked interactively if omitted. |
| `--install`           | Run `npm install` in the created directory after scaffold.           |
| `--no-install`        | Skip install.                                                         |
| `--yes`, `-y`         | Accept all defaults. Requires `<directory>` positional.              |
| `--force`, `-f`       | Overwrite a non-empty target directory.                              |
| `--help`, `-h`        | Show help.                                                            |

```bash
# interactive
npm create @hedwigjs/registry my-topics

# fully non-interactive
npm create @hedwigjs/registry my-topics --name @my-org/topics --yes
```

The initializer auto-detects the workspace's package manager
(`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, otherwise npm) and
delegates the install to it.

---

## What gets generated

```
my-topics/
├── package.json
├── tsconfig.json
├── README.md                 # workflow notes for your team
├── .gitignore                # node_modules, dist, src/index.generated.ts
├── scripts/
│   └── build.mjs             # codegen: scans src/domains → writes src/index.generated.ts
└── src/
    ├── index.ts              # re-exports index.generated (don't edit)
    ├── index.generated.ts    # AUTO-GENERATED — never hand-edit
    ├── domains/              # your topic contracts live here
    └── lib/
        └── contract.ts       # TopicContract type (don't edit)
```

Scripts in the generated package:

| Script            | What it does                                            |
| ----------------- | ------------------------------------------------------- |
| `npm run build`   | Codegen + `tsc`. Emits `dist/` ready to publish.        |
| `npm run dev`     | Watch codegen + `tsc --watch` in parallel.              |
| `prepublishOnly`  | Runs `npm run build` before `npm publish`.              |

---

## The contract shape

Each topic file exports a `default` object that `satisfies`
`TopicContract`. Codegen imports every topic by default export, so
**named exports won't be picked up** — always use `export default`.

Every topic has a **kind**. It is the thing that used to be decided at
every call site:

| `kind`    | Meaning                                                                 | Verb        | Extra field                 |
| --------- | ----------------------------------------------------------------------- | ----------- | --------------------------- |
| `event`   | A fact: "order paid". Fan-out to current subscribers.                   | `emit()`    | `retention` (optional, `{ last: N }`) — keep the last N for late subscribers |
| `request` | A command to one recipient that answers.                                | `request()` | `response` — the answer type (required) |
| `state`   | A current value: "cart has 2 items". The runtime keeps the last one and hands it to every new subscriber. | `emit()` | `retention` (optional, `{ last: 1 }` — the only value) |

```ts
// src/domains/notification/show.v1.ts — an event that keeps its last 10
import type { TopicContract } from "../../lib/contract";

export default {
  name: "notification.show.v1",
  kind: "event",
  retention: { last: 10 },
  description: "Show a toast notification.",
  payload: {} as { kind: "success" | "info" | "warn" | "error"; title: string; body?: string },
  examples: {
    happy: { kind: "success", title: "Order accepted" },
    error: { kind: "error", title: "Payment failed" },
  },
} satisfies TopicContract;

// src/domains/cart/add-item.v1.ts — a request with its answer type
export default {
  name: "cart.add-item.v1",
  kind: "request",
  description: "Add a product to the cart; answers with the resulting line.",
  payload: {} as { itemId: number; name: string; price: string },
  response: {} as { itemId: number; quantity: number; subtotal: number },
  examples: { happy: { itemId: 8, name: "Khachapuri", price: "890 ₽" } },
} satisfies TopicContract;

// src/domains/cart/snapshot.v1.ts — state
export default {
  name: "cart.snapshot.v1",
  kind: "state",
  retention: { last: 1 },
  description: "Full cart after every mutation.",
  payload: {} as { items: CartItem[]; totalItems: number; totalPrice: number },
  examples: { empty: { items: [], totalItems: 0, totalPrice: 0 } },
} satisfies TopicContract;
```

Fields:

| Field            | Required | Purpose                                                                                     |
| ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `name`           | yes      | Topic string. Must match the path: `<domain>/<action>.v<N>.ts` → `"<domain>.<action>.v<N>"`. |
| `kind`           | no¹      | `event` \| `request` \| `state`. See above.                                                 |
| `description`    | yes      | Human-readable. Shown in DevTools and hover cards.                                          |
| `payload`        | yes      | Payload type. Idiomatic: `{} as { ... }`.                                                   |
| `response`       | request  | The handler's answer type. Required for `request`, forbidden otherwise (codegen checks).    |
| `retention`      | no       | `{ last: N }`. On an `event`: the runtime keeps the last N messages of the topic for subscribers that ask for `replay`; without it nothing is kept. On `state`: only `{ last: 1 }`, which is also the default. Not allowed on a `request`. |
| `examples`       | yes      | Named fixtures. `examples.happy` is the default seed used by DevTools' Debug tab.           |
| `deprecatedBy`   | no       | Successor topic name. DevTools surfaces a warning.                                          |
| `observability`  | no       | Mark telemetry-only topics so `NACK NO_SUBSCRIBERS` renders neutrally instead of red.       |

¹ A contract without `kind` is an event; codegen prints a summary
warning so existing registries migrate at their own pace. `EventContract`
remains as a deprecated alias of `TopicContract` — don't use it in new
files.

The path-to-name convention and the `kind` / `response` / `retention`
rules are enforced by codegen — a mismatch fails the build with an
explicit error (`retention` on a request, a `state` topic with anything
but `last: 1`, a `last` that is not a positive integer). The build
summary counts kinds and retaining events:
`✔ Generated src/index.generated.ts (16 topics: 10 event, 5 request, 1 state; 3 event(s) with retention)`.

---

## Generated exports

Codegen writes `src/index.generated.ts` and `src/index.ts` re-exports
it. Consumers get these exports from the package root:

```ts
import { registry, TOPICS, TOPIC_KINDS, type Topic, type TopicPayloads, type TopicContracts } from "@my-org/topics";
```

| Export            | Kind  | Purpose                                                                                          |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `Topic`           | type  | String union of every topic.                                                                     |
| `TopicPayloads`   | type  | `{ [topic]: payload }` map.                                                                      |
| `TopicContracts`  | type  | `{ [topic]: { kind, response } }`. Third parameter of `createClient<Topic, TopicPayloads, TopicContracts>('id')`: `emit` accepts only events and state, `request` only requests, and the answer type is inferred. |
| `TopicKinds`      | type  | `{ [topic]: 'event' \| 'request' \| 'state' }`.                                                  |
| `EventTopic`, `RequestTopic`, `StateTopic` | type | Unions of topic names per kind.                                                  |
| `TopicResponses`  | type  | `{ [request topic]: response }`.                                                                 |
| `TOPICS`          | value | SCREAMING_SNAKE_CASE constants like `TOPICS.NOTIFICATION_SHOW_V1 === "notification.show.v1"`.    |
| `TOPIC_KINDS`     | value | The registry as the runtime needs it: `initBroker({ topics: TOPIC_KINDS })`. Each entry is a kind string, or `{ kind, retention }` for an event that declares `retention` — e.g. `"cart.snapshot.v1": "state"`, `"notification.show.v1": { kind: "event", retention: { last: 10 } }`. |
| `registry`        | value | Full `Record<name, TopicContract>`. Pass to `<MessageBrokerDevTools registry={registry} />`.     |

Each topic is also importable directly by path — useful when you only
need one contract:

```ts
import NotificationShow from "@my-org/topics/domains/notification/show.v1";

toastBus.emit(NotificationShow.name, { kind: "success", title: "Order accepted" });
```

---

## Using the registry in your app

The host boots the runtime once and hands it `TOPIC_KINDS`. That is all
the runtime needs to know about the registry — which topics are `state`
and which events keep how many messages:

```ts
// host — once per realm
import { initBroker } from "@hedwigjs/broker";
import { TOPIC_KINDS } from "@my-org/topics";

initBroker({ topics: TOPIC_KINDS });
```

The host can only cap what the contracts declared:
`history: { maxPerTopic, ttl, enabled }` (all optional; `enabled`
defaults to `true`).

Modules never depend on the runtime. They create a client with
`@hedwigjs/client` and the three generated types:

```ts
// a module
import { createClient } from "@hedwigjs/client";
import type { Topic, TopicPayloads, TopicContracts } from "@my-org/topics";

export const bus = createClient<Topic, TopicPayloads, TopicContracts>("cart-ui");

// state: the retained snapshot arrives synchronously inside on()
bus.on("cart.snapshot.v1", (msg) => render(msg.data));

// request: the answer type comes from the contract's `response`
const line = await bus.request("cart-store", "cart.add-item.v1", { itemId: 8, name: "Khachapuri", price: "890 ₽" });
line.data?.subtotal;                                   // number | undefined

// event with retention: a late subscriber asks for the last ones, then goes live
bus.on("notification.show.v1", (msg) => toast(msg.data), { replay: { limit: 10 } });

bus.emit("cart.add-item.v1", …);                       // compile error: a request cannot be emitted
```

Rename a topic in one place, and every `emit` / `on` / `request` in
your codebase lights up in TypeScript.

Wire the registry into DevTools for autocomplete and payload prefill:

```tsx
import { getBroker } from "@hedwigjs/broker";
import { MessageBrokerDevTools } from "@hedwigjs/devtools";
import { registry } from "@my-org/topics";

<MessageBrokerDevTools broker={getBroker()} registry={registry} enabled />
```

`TopicContract` is structurally compatible with the `TopicContractInfo`
shape DevTools consumes (`name`, `kind`, `description`, `examples`,
`deprecatedBy`, `observability`) — no adapter needed.

Use `TOPICS` at call sites when you'd rather have autocomplete than
string literals:

```ts
toastBus.emit(TOPICS.NOTIFICATION_SHOW_V1, { kind: "success", title: "Order accepted" });
```

---

## Adding a topic

1. Create `src/domains/<domain>/<action>.v1.ts` — one topic per file.
2. Fill in `name` (must match the path), `kind`, `description`,
   `payload`, and at least an `examples.happy` fixture. A request also
   needs `response`; an event may add `retention`.
3. `npm run dev` picks it up automatically; `npm run build` produces
   the final `dist/`.

Path convention (enforced by codegen):

- `<domain>` and `<action>` are kebab-case: `[a-z][a-z0-9-]*`.
- Nesting depth is exactly one: `src/domains/<domain>/<file>.ts`.
- File name matches `<action>.v<N>.ts`.

Violations fail the build with an explicit message.

---

## Versioning workflow

Topics are versioned in the name (`.v1`, `.v2`, …). When a contract
must change in a breaking way:

1. Copy `src/domains/<domain>/<action>.v1.ts` → `<action>.v2.ts`.
2. Update `name` to `<domain>.<action>.v2` and revise the payload.
3. In `<action>.v1.ts` add `deprecatedBy: "<domain>.<action>.v2"`.
4. `npm run build`.

Both versions ship side by side in the generated registry. Consumers
migrate at their own pace; DevTools shows the deprecation warning on
every v1 message so nothing rots silently.

Changing a topic's kind is a breaking change too — a request that
becomes an event changes who answers — so it is a new version as well.

---

## When to use — and when not to

**Use `@hedwigjs/create-registry` when:**

- Greenfield TS project, no existing contract pipeline.
- You want DevTools autocomplete + payload examples out of the box.
- You value the enforced path/name convention for grep-ability.

**Use your own pipeline when:**

- Contracts are already generated (Zod, Protobuf, GraphQL codegen,
  OpenAPI, hand-written `TopicMap`).
- Non-TS producers publish to the same broker — the source of truth
  lives outside TypeScript.
- You want a different file layout or naming convention.

In both cases, `@hedwigjs/client` accepts your `Topic` +
`TopicPayloads` types as generic parameters, plus an optional
`TopicContracts` map for kind-aware verbs. Nothing forces the
starter — see
[Bring your own contracts](../../docs/content/guides/bring-your-own-contracts.md).

---

## License

MIT.
