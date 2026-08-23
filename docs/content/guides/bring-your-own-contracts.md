# Bring your own contracts

`@hedwigjs/broker` is contract-first: every topic has a name and a typed
payload. But **where those types come from is your choice**. Broker's
generic signature is deliberately minimal:

```ts
Client<T extends string, P extends Record<T, any>>
```

Two TypeScript types — that's the whole contract. `T` is the union of topic
names; `P` is the mapping topic → payload. No opinion about how you produce
them.

This guide shows five patterns for producing `Topic` + `TopicPayloads`, from
the opinionated starter to bring-your-own codegen.

## Table of contents

1. [Starter kit: `@hedwigjs/create-registry`](#1-starter-kit-hedwigjscreate-registry)
2. [Hand-written `TopicMap`](#2-hand-written-topicmap)
3. [Zod schemas](#3-zod-schemas)
4. [Protobuf](#4-protobuf)
5. [GraphQL / AsyncAPI / OpenAPI codegen](#5-graphql--asyncapi--openapi-codegen)
6. [Mixed sources](#6-mixed-sources)
7. [What DevTools needs (optional metadata)](#7-what-devtools-needs-optional-metadata)

---

## 1. Starter kit: `@hedwigjs/create-registry`

Opinionated scaffolder for TS-first, greenfield projects.

```bash
npm create @hedwigjs/registry my-topics --name @my-org/topics
```

Creates a standalone TypeScript workspace with codegen. Every event lives in
one file:

```ts
// my-topics/src/domains/cart/item-added.v1.ts
import type { EventContract } from "../../lib/contract";

export default {
  name: "cart.item-added.v1",
  description: "Item added to cart.",
  payload: {} as { itemId: number; name: string; price: string },
  examples: {
    happy: { itemId: 1, name: "Хачапури", price: "890" },
  },
} as const satisfies EventContract;
```

`npm run build` regenerates `src/index.generated.ts`:

```ts
export const registry = { "cart.item-added.v1": itemAddedV1, ... } as const;
export type Topic = keyof typeof registry;
export type TopicPayloads = { [K in Topic]: typeof registry[K] extends { payload: infer P } ? P : never };
```

Consumers install `@my-org/topics` as a normal npm dep. Broker:

```ts
import type { Topic, TopicPayloads } from "@my-org/topics";
const client = createClient<Topic, TopicPayloads>("cart");
```

**When to use:** greenfield TS-first project, no existing contracts pipeline,
you want fixture examples wired into DevTools for free.

**Trade-off:** opinionated directory structure and build step. If you already
have schemas somewhere else, use one of the patterns below.

---

## 2. Hand-written `TopicMap`

Fine for small projects (up to ~50 topics). Single file, zero codegen.

```ts
// packages/contracts/index.ts
export type TopicMap = {
  "cart.item-added.v1": { itemId: number; name: string; price: string };
  "cart.item-removed.v1": { itemId: number };
  "user.login.v1": { userId: string };
  // ...
};
export type Topic = keyof TopicMap;
export type TopicPayloads = TopicMap;
```

That's it. Use directly:

```ts
import type { Topic, TopicPayloads } from "./contracts";
const client = createClient<Topic, TopicPayloads>("cart");
```

**When to use:** small project, no cross-team ownership of topics, no need
for per-topic metadata (description / examples).

**Trade-off:** doesn't scale beyond ~50 topics — merge conflicts, hard to
review PRs, one file gets huge.

---

## 3. Zod schemas

If you already use [Zod](https://zod.dev) for runtime validation, reuse the
same schemas as source of truth for topic payloads.

```ts
import { z } from "zod";

export const schemas = {
  "cart.item-added.v1": z.object({
    itemId: z.number(),
    name: z.string(),
    price: z.string(),
  }),
  "user.login.v1": z.object({
    userId: z.string(),
  }),
} as const;

export type Topic = keyof typeof schemas;
export type TopicPayloads = {
  [K in Topic]: z.infer<typeof schemas[K]>;
};
```

Bonus: use the same schemas for runtime validation inside adapters
(RFC-0001) — validate every incoming external message against its schema
before letting it into the bus.

**When to use:** already committed to Zod for API validation, want one
source of truth for both runtime validation and TS types.

---

## 4. Protobuf

If your backend defines events in Protobuf, generate TS types via
`protoc-gen-ts` or `ts-proto`:

```protobuf
// cart.proto
syntax = "proto3";
package cart;

message ItemAdded {
  int32 item_id = 1;
  string name = 2;
  string price = 3;
}
```

```bash
protoc --ts_out=./generated cart.proto
```

Then compose your TopicMap manually or via a codegen wrapper:

```ts
import type { ItemAdded, ItemRemoved } from "./generated/cart";

export type TopicMap = {
  "cart.item-added.v1": ItemAdded;
  "cart.item-removed.v1": ItemRemoved;
};
export type Topic = keyof TopicMap;
export type TopicPayloads = TopicMap;
```

**When to use:** backend is Protobuf-first (gRPC, Kafka with Protobuf
schemas), you want one contract shared between server producer and frontend
consumer.

---

## 5. GraphQL / AsyncAPI / OpenAPI codegen

Any tool that generates TS types works. Adapter is trivially the same
"compose the map" step:

```ts
import type { UserLoginPayload, CartItemAddedPayload } from "./generated/graphql";

export type TopicMap = {
  "user.login.v1": UserLoginPayload;
  "cart.item-added.v1": CartItemAddedPayload;
};
```

Common toolchains:
- **GraphQL:** [graphql-codegen](https://the-guild.dev/graphql/codegen)
- **AsyncAPI:** [asyncapi-generator](https://github.com/asyncapi/generator)
  with a TS template — natural fit since AsyncAPI is designed for
  event-driven contracts.
- **OpenAPI:** [openapi-typescript](https://github.com/drwpow/openapi-typescript)
  — pull schemas from an existing REST API and reuse them for events.

**When to use:** existing schema-as-code pipeline in the org. Zero reason
to reinvent it just for the bus.

---

## 6. Mixed sources

Nothing prevents combining. Each domain owns its topics:

```ts
import type { CartTopicMap } from "@my-org/topics";              // create-registry
import type { AnalyticsTopicMap } from "./analytics-schemas";     // Zod
import type { PaymentEvents } from "./generated/payments-pb";     // Protobuf

export type TopicMap = CartTopicMap & {
  "analytics.click.v1": AnalyticsTopicMap["analytics.click.v1"];
} & {
  "payment.captured.v1": PaymentEvents.Captured;
};
export type Topic = keyof TopicMap;
export type TopicPayloads = TopicMap;
```

Broker sees one composed map. Ownership can be distributed across
different teams and different tooling — the bus stays coherent.

---

## 7. What DevTools needs (optional metadata)

`@hedwigjs/devtools` is decoupled from your topic-source too. It accepts a
prop `registry` shaped as:

```ts
type TopicsRegistry = Record<string, TopicContractInfo>;

interface TopicContractInfo {
  name: string;
  description: string;
  examples?: Record<string, unknown>;   // fixtures for the debug tab
  deprecatedBy?: string;
}
```

Where you produce this object is again your choice:

- **`create-registry`** — exports `registry` matching this shape verbatim.
- **Hand-written** — write it once, keep alongside your `TopicMap`.
- **From Zod** — add a `.describe(...)` and adapt into the shape.
- **From Protobuf/GraphQL** — pull `description` from schema annotations.
- **Skip entirely** — pass `registry={undefined}`; DevTools shows an empty
  metadata pane, everything else keeps working.

DevTools doesn't require metadata to function — messages log and clients
log work on live broker state alone. Metadata just enriches the UI when
present.

---

## Summary

| Pattern | Best for | Trade-off |
| --- | --- | --- |
| `create-registry` | Greenfield TS project | Opinionated structure, extra build step |
| Hand-written `TopicMap` | Small project (≤50 topics) | Doesn't scale, no metadata |
| Zod | Already using Zod for validation | Runtime overhead of Zod parse |
| Protobuf | Backend is Protobuf-first | Requires protoc toolchain |
| GraphQL / OpenAPI / AsyncAPI codegen | Existing schema-as-code pipeline | Depends on the specific codegen tool |
| Mixed | Distributed ownership across teams | Composition boilerplate |

**Broker doesn't care which one you pick.** As long as you produce a
`Topic` union and a `TopicPayloads` mapping, `createClient<Topic,
TopicPayloads>("id")` works.
