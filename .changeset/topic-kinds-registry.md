---
"@hedwigjs/create-registry": minor
---

Topic kinds in contracts. `TopicContract` (formerly `EventContract`, kept
as a deprecated alias) gains `kind: 'event' | 'request' | 'state'`;
requests declare their answer as `response`, state topics may set
`retention: { last: 1 }`. Codegen validates the rules (a request must
declare `response`, nothing else may), treats a missing `kind` as `event`
with a summary warning, and emits `TopicKinds`, `EventTopic` /
`RequestTopic` / `StateTopic`, `TopicResponses`, `TopicContracts` (the
third parameter of `createClient<Topic, TopicPayloads, TopicContracts>`)
and the runtime map `TOPIC_KINDS`.
