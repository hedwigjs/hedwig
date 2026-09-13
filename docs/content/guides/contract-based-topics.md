# Contract-based topics

How to describe topics once, in a registry, so that the type checker,
the runtime, DevTools and a backend in another language all agree on
what each topic is.

## Three kinds

| Kind      | Meaning                                                                  | Verb        | What the runtime does                                                |
| --------- | ------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------- |
| `event`   | A fact: "order paid". Whoever is subscribed now hears it.                | `emit()`    | Fan-out; optional `history: true` for explicit replay.               |
| `request` | A command to one recipient that answers: "add item 8".                   | `request()` | Unicast, answer in `RoutingResult.data`; over a wire as `kind: 'request'`. Never recorded. |
| `state`   | A current value: "cart has 2 items, 3360 ₽". Old values are worthless.   | `emit()`    | Retains the last value and hands it to every new subscriber on `on()`. |

Analogy: an event is a log line, state is a cell, a request is a call.

## The contract

One file per topic under `src/domains/<domain>/<action>.v<N>.ts`,
exported as default and checked with `satisfies TopicContract`:

```ts
// cart/snapshot.v1.ts — state
export default {
  name: "cart.snapshot.v1",
  kind: "state",
  retention: { last: 1 },                 // optional; the default
  description: "Full cart after every mutation.",
  payload: {} as { items: CartItem[]; totalItems: number; totalPrice: number },
  examples: { empty: { items: [], totalItems: 0, totalPrice: 0 } },
} satisfies TopicContract;

// cart/add-item.v1.ts — request
export default {
  name: "cart.add-item.v1",
  kind: "request",
  description: "Add a product; answers with the resulting line.",
  payload: {} as { itemId: number; name: string; price: string },
  response: {} as { itemId: number; quantity: number; subtotal: number },
  examples: { happy: { itemId: 8, name: "Khachapuri", price: "890 ₽" } },
} satisfies TopicContract;
```

A contract without `kind` is an event; codegen says so once per build so
an existing registry migrates at its own pace. Codegen refuses a request
without `response` and a `response` on anything else.

## What the generator produces

`npm run build` in the registry writes `index.generated.ts`:

- `Topic`, `TopicPayloads` — as before.
- `TopicContracts` — `{ [topic]: { kind, response } }`. Pass it as the
  third parameter of `createClient` and the verbs become kind-aware.
- `EventTopic`, `RequestTopic`, `StateTopic`, `TopicKinds`,
  `TopicResponses` — for your own generic code.
- `TOPIC_KINDS` — the runtime map for `initBroker({ topics: TOPIC_KINDS })`.
- `registry` — the full catalogue for `<MessageBrokerDevTools registry={registry} />`.

## In a module

```ts
import { createClient } from '@hedwigjs/client';
import type { Topic, TopicPayloads, TopicContracts } from '@my-org/topics';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('cart-ui');

// state: the retained snapshot arrives synchronously inside on()
bus.on('cart.snapshot.v1', (msg) => render(msg.data));

// request: the answer type comes from the contract
const line = await bus.request('cart-store', 'cart.add-item.v1', { itemId: 8, name: 'Khachapuri', price: '890 ₽' });
line.data?.subtotal;                       // number | undefined

bus.emit('cart.add-item.v1', …);           // compile error: a request cannot be emitted
bus.request('cart-store', 'cart.snapshot.v1', …); // compile error: state cannot be requested
```

## In the host

```ts
import { initBroker } from '@hedwigjs/broker';
import { TOPIC_KINDS } from '@my-org/topics';

initBroker({ topics: TOPIC_KINDS });
```

That is the only runtime-side change: `state` topics are retained from
then on. Everything else — verbs, answer types — is enforced by the type
checker, so an untyped JavaScript module still works, it just gets no
help.

## Versioning

Topics carry their version in the name (`.v1`, `.v2`). A breaking change
to a payload or an answer is a new file, `action.v2.ts`, with
`deprecatedBy: "domain.action.v2"` on the old one; DevTools surfaces the
deprecation. Changing a topic's kind is breaking too — a request that
becomes an event changes who answers — so it is a new version as well.
Producers and consumers migrate independently because both versions
coexist in the registry.

## What stays explicit

- `history: true` on `emit()` remains for **events** that a late
  subscriber may want replayed (with `replay` on `on()`); state does not
  need it.
- `observability: true` marks telemetry-only topics so DevTools renders a
  `NACK NO_SUBSCRIBERS` on them neutrally.
