# @hedwigjs/create-registry

**Optional starter kit.** Scaffolds an opinionated topics-registry workspace
for TS-first, greenfield projects — codegen, `EventContract` type, and
per-event contract files under `src/domains/`.

> `@hedwigjs/broker` accepts topic types from **any source** — Zod, Protobuf,
> GraphQL, hand-written `TopicMap`, or a mix. This package is a convenience
> layer for teams starting fresh with TypeScript. If you already have a
> contracts pipeline, use it — see
> [Bring your own contracts](../../docs/content/guides/bring-your-own-contracts.md).

> Pre-release. Not yet published to npm.

## Usage (planned)

```bash
npm create @hedwigjs/registry my-topics
# or:
npm create @hedwigjs/registry my-topics --name @my-org/topics --yes
```

Creates a new directory `my-topics/` with:

```
my-topics/
├── package.json
├── tsconfig.json
├── scripts/build.mjs          # scans src/domains → generates src/index.generated.ts
├── src/
│   ├── index.ts               # re-exports index.generated
│   ├── index.generated.ts     # written by build.mjs
│   ├── domains/               # your event contracts live here
│   └── lib/contract.ts        # EventContract<Name, Payload> type
├── README.md
└── .gitignore
```

The created workspace has **no runtime dependency on `@hedwigjs/*`** — it's a
plain TypeScript package that ships types and (optionally) fixture payloads.
Consumers of your topic-registry can be anything: `@hedwigjs/broker` clients,
custom pub/sub, tests, or docs generators.

## Contract shape

Each `src/domains/<domain>/<event>.v1.ts` exports a `satisfies` clause:

```ts
import type { EventContract } from "../../lib/contract";

export const notificationShowV1 = {
  name: "notification.show.v1",
  description: "Show a toast notification.",
  payload: {} as { kind: "success" | "info" | "warn" | "error"; title: string; body?: string },
  examples: {
    happy: { kind: "success", title: "Заказ принят" },
    error: { kind: "error", title: "Оплата не прошла" },
  },
} as const satisfies EventContract;
```

`scripts/build.mjs` scans these files, produces `index.generated.ts` with a
composed `TopicMap` and a topic list. Result plugs into
`createClient<Topic, TopicPayloads>(id)`.

## Scripts (this package)

- `npm run build` — compile `src/*.ts` → `dist/` (tsc).
- `npm run dev` — tsc watch mode.
- `npm run typecheck` — type-check without emit.

## License

MIT.
