# @hedwig-demo/contracts

Реестр топиков референс-стенда «Hedwig Café» (`examples/advanced`). Создан через initializer `@hedwigjs/create-registry` и немного доработан под монорепо: пакет приватный (`private: true`, в npm не публикуется), в `dist/` не собирается — shell, MFE и backend подключают его как воркспейс прямо из `src/`.

## Что в реестре

16 топиков в 5 доменах: 10 `event`, 5 `request`, 1 `state`. У трёх событий объявлен `retention`.

| Домен | Топик | Род | Кто и зачем |
|---|---|---|---|
| `cart` | `cart.add-item.v1` | request | menu, cart-ui → `cart-store`: добавить блюдо. Ответ — количество в строке и промежуточная сумма |
| | `cart.decrement.v1` | request | menu, cart-ui → `cart-store`: минус одна единица. `quantity: 0` в ответе — строка удалена |
| | `cart.remove-item.v1` | request | cart-ui, checkout → `cart-store`: убрать строку целиком |
| | `cart.snapshot.v1` | state | `cart-store` публикует после каждой мутации. Рантайм держит последний снимок и отдаёт его каждому новому подписчику внутри `on()`. Через remote-клиент `tabs` уходит и в другие вкладки |
| `chat` | `chat.message-sent.v1` | event, `retention: { last: 50 }` | ai-chat: пользователь отправил сообщение. `observability: true` |
| | `chat.reply-started.v1` | event | ai-chat: ассистент начал отвечать. `observability: true` |
| | `chat.reply-chunk.v1` | event | remote-клиент `ai-backend` (SSE): очередной кусок ответа |
| | `chat.reply-completed.v1` | event, `retention: { last: 50 }` | `ai-backend`: ответ закончен, полный текст |
| | `chat.reply-cancelled.v1` | event | ai-chat: пользователь остановил стрим. `observability: true` |
| `checkout` | `checkout.start.v1` | request | cart-ui → `checkout`: передать корзину в оформление. Ответ — `sessionId` и `ready: true` |
| | `checkout.completed.v1` | event | remote-клиент `checkout-iframe` (postMessage): оплата прошла |
| | `checkout.cancelled.v1` | event | checkout: пользователь закрыл модалку |
| `notification` | `notification.show.v1` | event, `retention: { last: 10 }` | Тост. Публикуют remote-клиент `notifications-backend` (WebSocket) и checkout |
| | `notification.status.v1` | request | `remote-request-demo` → `notifications-backend`: запрос через провод, backend отвечает кадром-ответом |
| `ui` | `ui.menu-item-opened.v1` | event | menu: открыта карточка блюда |
| | `ui.menu-item-closed.v1` | event | menu: карточка закрыта |

Что это значит для рантайма (`TOPIC_KINDS`, который shell передаёт в `initBroker`): `cart.snapshot.v1` хранит последнее значение; `notification.show.v1` — последние 10 сообщений, `chat.message-sent.v1` и `chat.reply-completed.v1` — последние 50 (для реплея опоздавшим подписчикам и для вкладки Replay Buffer в DevTools); запросы не хранятся никогда. Остальные события нигде не оседают.

## Структура

```
src/
├── domains/<domain>/<action>.v<N>.ts   ← контракты, один файл = один топик
├── shared-types.ts                     ← общие типы payload'ов (CartItem, MenuItem, NotificationKind) — не контракты, в codegen не участвуют
├── lib/contract.ts                     ← тип TopicContract (копия из шаблона, не трогать)
├── index.ts                            ← публичный entry: реэкспорт index.generated + shared-types + типы ответов
└── index.generated.ts                  ← агрегат, генерится; закоммичен, CI проверяет, что он не устарел
scripts/
└── build.mjs                           ← codegen (копия из шаблона)
```

Отличия от того, что создаёт initializer:

- `index.ts` дополнен вручную: кроме `index.generated` экспортирует `shared-types` и именованные типы ответов (`CartAddItemResponse`, `CartDecrementResponse`, `CartRemoveItemResponse`, `CheckoutStartResponse`, `NotificationStatusResponse`).
- `index.generated.ts` не в `.gitignore` — он закоммичен, потому что воркспейсы читают `src/` напрямую. CI пересобирает его и падает, если результат отличается от закоммиченного.
- Импорт по пути (`@hedwig-demo/contracts/domains/...`) не настроен — в `exports` только корень пакета.

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run build` | Codegen: `src/domains/**` → `src/index.generated.ts`. `npm run dev:demo` в корне вызывает его автоматически (`predev`) |
| `npm run dev` | Codegen в режиме watch — одна из панелей `npm run dev:demo` |
| `npm run typecheck` | `tsc --noEmit`; входит в корневой `npm run typecheck` |

Из корня монорепо: `npm run build -w @hedwig-demo/contracts`.

## Добавление топика

1. Создать `src/domains/<domain>/<action>.v1.ts` по образцу соседей:

```ts
import type { TopicContract } from "../../lib/contract";

export default {
  name: "<domain>.<action>.v1",
  kind: "event",                // event | request | state
  // retention: { last: 10 },   // только у event: сколько последних держать для опоздавших
  description: "Описание топика",
  payload: {} as {
    // ...
  },
  // response: {} as { ... },   // только у request: тип ответа обработчика
  examples: {
    happy: { /* ... */ },
  },
} as const satisfies TopicContract;
```

2. Поменять `name`, `kind`, `description`, `payload`, `examples` (у `request` — ещё и `response`). Общие типы payload'ов — в `shared-types.ts`.
3. `npm run build -w @hedwig-demo/contracts` и закоммитить обновлённый `index.generated.ts`.
4. Если топик будут слушать или слать MFE — добавить правило в `shell/src/security/acl.ts`: ACL запрещает всё, что не разрешено явно.

Конвенция: имя домена и action в `name` **обязательно** должны совпадать с путём — `cart/snapshot.v1.ts` → `name: "cart.snapshot.v1"`. Codegen упадёт с ошибкой при расхождении. Он же проверяет `kind`: у `request` должен быть `response`, у остальных его быть не должно; `retention` нельзя указывать у `request`, у `state` допустимо только `{ last: 1 }`, а `last` — целое число больше нуля. Контракт без `kind` считается событием (с предупреждением); `EventContract` — deprecated-псевдоним `TopicContract`, в новых файлах не используется.

## Версионирование

При изменении контракта опубликованного топика:

1. Скопировать `<action>.v1.ts` → `<action>.v2.ts`
2. Поменять `name` на `...v2`
3. В `<action>.v1.ts` добавить `deprecatedBy: "<domain>.<action>.v2"`
4. `npm run build`

Смена `kind` — тоже ломающее изменение, поэтому это новая версия.

## Использование в MFE

Модули не зависят от `@hedwigjs/broker`. Клиент создаётся через `@hedwigjs/client` с тремя сгенерированными типами, React-хуки привязываются к нему один раз (`bindHooks` из `@hedwigjs/react`):

```ts
// mfe/menu/src/clients/bus.ts
import { createClient } from '@hedwigjs/client';
import { bindHooks } from '@hedwigjs/react';
import type { Topic, TopicContracts, TopicPayloads } from '@hedwig-demo/contracts';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('menu');
export const { useStateTopic, useTopic, useRequest } = bindHooks(bus);
```

```ts
// в компонентах — без аргумента client
const snapshot = useStateTopic('cart.snapshot.v1');                      // state: последний снимок сразу, до первого кадра
const result = await bus.request('cart-store', 'cart.add-item.v1', item); // request: в result.data — CartAddItemResponse
```

`ai-chat` и `analytics` обходятся одним `createClient` без хуков.

## Хост (shell)

Shell один раз поднимает рантайм и отдаёт ему `TOPIC_KINDS` — род каждого топика и `retention`. `debug: true` включает канал для вкладки Debug в DevTools:

```ts
// shell/src/index.ts
import { initBroker } from '@hedwigjs/broker';
import { TOPIC_KINDS } from '@hedwig-demo/contracts';

initBroker({ topics: TOPIC_KINDS, debug: true });
```

DevTools получает `registry` — описания, фикстуры `examples` для Debug, пометки `deprecatedBy` и `observability`:

```tsx
// shell/src/devtools.tsx
import { getBroker } from '@hedwigjs/broker';
import { MessageBrokerDevTools } from '@hedwigjs/devtools';
import { registry } from '@hedwig-demo/contracts';

<MessageBrokerDevTools broker={getBroker()} registry={registry} enabled defaultOpen={false} />
```
