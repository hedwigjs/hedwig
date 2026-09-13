---
"@hedwigjs/client": minor
"@hedwigjs/broker": minor
---

Topic kinds in the SDK and the runtime. `createClient<Topic, TopicPayloads,
TopicContracts>()` makes the verbs kind-aware: `emit` accepts only events
and state, `request` only requests and infers the answer type from the
contract's `response`; without the third parameter every topic stays open
to both verbs. `state` topics are retained by the runtime
(`initBroker({ topics: TOPIC_KINDS })`): the last local multicast per
state topic is kept, `inspect.getRetained()` lists them, a
`state.retained` system event fires, and every new `on()` receives the
value synchronously as `replayed: true` (opt out with
`{ retained: false }`; a `replay` option takes precedence). `history` on
`request()` is gone — a request is never recorded, `RequestOptions` is
`{ timeout }` only, and the `request.history_deprecated` warning with it.
