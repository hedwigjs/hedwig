# @hedwig-demo/contracts

Реестр топиков для `@hedwigjs/broker`. Создан через initializer `@hedwigjs/create-registry`.

## Структура

```
src/
├── domains/<domain>/<action>.v<N>.ts   ← события, один файл = одно событие
├── lib/contract.ts                     ← тип EventContract (не трогать)
├── index.ts                            ← публичный entry (не трогать)
└── index.generated.ts                  ← агрегат, генерится автоматически
scripts/
└── build.mjs                           ← codegen
```

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | Watch-сборка во время разработки |
| `npm run build` | Одноразовая сборка перед публикацией |

## Добавление события

1. Скопировать соседний event-файл (или создать новый по шаблону ниже) в `src/domains/<domain>/<action>.v1.ts`:

```ts
import type { EventContract } from "../../lib/contract";

export default {
  name: "<domain>.<action>.v1",
  description: "Описание события",

  payload: {} as {
    // ...
  },

  examples: {
    happy: { /* ... */ },
  },
} satisfies EventContract;
```

2. Поменять `name`, `description`, `payload`, `examples`
3. `npm run build` (или watch автоматом подхватит)

Конвенция: имя домена и action в `name` **обязательно** должны совпадать с путём — `users/fetched.v1.ts` → `name: "users.fetched.v1"`. Codegen упадёт с ошибкой при расхождении.

## Версионирование

При изменении контракта опубликованного события:

1. Скопировать `<action>.v1.ts` → `<action>.v2.ts`
2. Поменять `name` на `...v2`
3. В `<action>.v1.ts` добавить `deprecatedBy: "<domain>.<action>.v2"`
4. `npm run build`

## Использование в MFE

```ts
import UsersFetched from "@hedwig-demo/contracts/domains/users/fetched.v1";

client.emit(UsersFetched.name, {
  users: [...],
  fetchedAt: Date.now(),
});
```

## Использование всего реестра (DevTools, типы брокера)

```ts
import { initBroker } from "@hedwigjs/broker";
import type { Topic, TopicPayloads } from "@hedwig-demo/contracts";

initBroker<Topic, TopicPayloads>({...});
```

```ts
import { mountDevTools } from "@hedwigjs/devtools";
import { registry } from "@hedwig-demo/contracts";

mountDevTools({ broker, registry });
```
