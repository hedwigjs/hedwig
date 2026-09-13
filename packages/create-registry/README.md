# @hedwigjs/create-registry

Optional starter kit. Scaffolds an opinionated topics-registry
workspace for `@hedwigjs/broker` — a codegen-driven TypeScript package
where each event lives in its own file and the runtime types
(`Topic`, `TopicPayloads`, `TOPICS`, `registry`) are generated for you.

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
- [The `EventContract` shape](#the-eventcontract-shape)
- [Generated exports](#generated-exports)
- [Using the registry in your app](#using-the-registry-in-your-app)
- [Adding an event](#adding-an-event)
- [Versioning workflow](#versioning-workflow)
- [When to use — and when not to](#when-to-use--and-when-not-to)
- [License](#license)

---

## What it does

Running the initializer creates a standalone TypeScript package with:

- A file convention: one event per file at `src/domains/<domain>/<action>.v<N>.ts`.
- A tiny `EventContract<Name, Payload>` type.
- A codegen (`scripts/build.mjs`) that scans `src/domains/`, validates
  names, and writes `src/index.generated.ts` — a composed registry
  plus the exact `Topic` / `TopicPayloads` types `@hedwigjs/broker`
  expects, and a `TOPICS` constant map you can use to avoid string
  typos at call sites.

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
├── .gitignore
├── scripts/
│   └── build.mjs             # codegen: scans src/domains → writes src/index.generated.ts
└── src/
    ├── index.ts              # re-exports index.generated (don't edit)
    ├── index.generated.ts    # AUTO-GENERATED — never hand-edit
    ├── domains/              # your event contracts live here
    └── lib/
        └── contract.ts       # EventContract<Name, Payload> type (don't edit)
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
| `event`   | A fact: "order paid". Fan-out to current subscribers.                   | `emit()`    | —                           |
| `request` | A command to one recipient that answers.                                | `request()` | `response` — the answer type |
| `state`   | A current value: "cart has 2 items". The runtime keeps the last one and hands it to every new subscriber. | `emit()` | `retention` (optional, `{ last: 1 }`) |

```ts
// src/domains/notification/show.v1.ts — an event
import type { TopicContract } from "../../lib/contract";

export default {
  name: "notification.show.v1",
  kind: "event",
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
| `retention`      | no       | `state` only. `{ last: 1 }` — the only policy for now; the default.                         |
| `examples`       | yes      | Named fixtures. `examples.happy` is the default seed used by DevTools' Debug tab.           |
| `deprecatedBy`   | no       | Successor topic name. DevTools surfaces a warning.                                          |
| `observability`  | no       | Mark telemetry-only topics so `NACK NO_SUBSCRIBERS` renders neutrally instead of red.       |

¹ A contract without `kind` is an event; codegen prints a summary
warning so existing registries migrate at their own pace. `EventContract`
remains as a deprecated alias of `TopicContract`.

The path-to-name convention and the `kind` / `response` rules are enforced
by codegen — a mismatch fails the build with an explicit error.

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
| `TOPICS`          | value | SCREAMING_SNAKE_CASE constants like `TOPICS.CART_ITEM_ADDED_V1 === "cart.item-added.v1"`.          |
| `TOPIC_KINDS`     | value | `{ [topic]: kind }` for the runtime: `initBroker({ topics: TOPIC_KINDS })` turns on retention for state topics. |
| `registry`        | value | Full `Record<name, TopicContract>`. Pass to `<MessageBrokerDevTools registry={registry} />`.     |

Each event is also importable directly by path — useful when you only
need one contract:

```ts
import CartItemAdded from "@my-org/topics/domains/cart/item-added.v1";

cartClient.emit(CartItemAdded.name, { sku: "CROISSANT", qty: 2 });
```

---

## Using the registry in your app

Boot the broker with the generated types:

```ts
import { initBroker, createClient } from "@hedwigjs/broker";
import type { Topic, TopicPayloads } from "@my-org/topics";

initBroker<Topic, TopicPayloads>({ history: { enabled: true, maxSize: 200 } });

const cartClient = createClient<Topic, TopicPayloads>("cart");
```

Rename a topic in one place, and every `emit` / `on` / `request` in
your codebase lights up in TypeScript.

Wire the registry into DevTools for autocomplete and payload prefill:

```tsx
import { getBroker } from "@hedwigjs/broker";
import { MessageBrokerDevTools } from "@hedwigjs/devtools";
import { registry } from "@my-org/topics";

<MessageBrokerDevTools broker={getBroker()} registry={registry} />
```

`EventContract` is structurally compatible with the
`TopicContractInfo` shape DevTools consumes — no adapter needed.

Use `TOPICS` at call sites when you'd rather have autocomplete than
string literals:

```ts
cartClient.emit(TOPICS.CART_ITEM_ADDED_V1, { sku: "CROISSANT", qty: 2 });
```

---

## Adding an event

1. Create `src/domains/<domain>/<action>.v1.ts` — one event per file.
2. Fill in `name` (must match the path), `description`, `payload`,
   and at least an `examples.happy` fixture.
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

In both cases, `@hedwigjs/broker` accepts your `Topic` +
`TopicPayloads` types as generic parameters. Nothing forces the
starter — see
[Bring your own contracts](../../docs/content/guides/bring-your-own-contracts.md).

---

## License

MIT.
