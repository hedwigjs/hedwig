# benchmarks-legacy/

Не запускается на текущем build'е. Оставлено как reference из hse-версии
`@message-broker/core`.

Причины:

- Скрипты require'ят `../dist/core/BrokerCore` и `../dist/client/InMemoryClient` —
  per-file layout, которого tsup-бандл (`dist/index.mjs` / `dist/index.cjs`)
  не даёт.
- `InMemoryClient` в текущей кодовой базе называется `BrokerClient` и
  создаётся через `createClient(id)`, а не `new InMemoryClient(id, core)`.

Переписать поверх публичного API (`initBroker` + `createClient`) как отдельную
задачу; после этого перенести обратно в `benchmarks/` и восстановить bench-скрипты
в `package.json`.
