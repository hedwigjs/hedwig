/**
 * Форма контракта одного топика.
 * Используется через `satisfies` в файлах domains/.
 *
 * Этот файл копируется initializer'ом в org-package при создании реестра.
 * После copy редактирование не предполагается.
 */

/**
 * Род топика — то, что раньше решалось в каждом месте вызова.
 *
 * - `event`   — факт: «заказ оплачен». Рассылается всем подписчикам через
 *               `emit()`; кто подключился позже, того уже не касается.
 * - `request` — команда одному адресату через `request()`, с ответом
 *               (`response`). Через провод уходит как `kind: 'request'`.
 * - `state`   — текущее значение: «в корзине две позиции». Рантайм хранит
 *               последнее значение и отдаёт его новому подписчику сразу.
 *
 * Событие может объявить `retention: { last: N }` — тогда рантайм держит
 * последние N сообщений для опоздавших (`on(topic, fn, { replay })`).
 */
export type TopicKind = "event" | "request" | "state";

interface TopicContractBase<TName extends string = string, TPayload = unknown> {
  /** Имя топика, формат: <domain>.<action>.v<N> */
  name: TName;

  /** Описание для DevTools и команды */
  description: string;

  /** Тип payload — объявляется через `as { ... }` */
  payload: TPayload;

  /** Фикстуры для тестов и DevTools-имитации. Минимум — ключ `happy` */
  examples: Record<string, TPayload>;

  /** Если топик deprecated — указатель на новую версию */
  deprecatedBy?: string;

  /**
   * Отмечает топик как чисто телеметрический (трейс, TTFB-hint и т.п.):
   * по замыслу у него может не быть business-подписчиков, и
   * `NACK NO_SUBSCRIBERS` для него — ожидаемое состояние, а не ошибка.
   *
   * DevTools использует этот флаг чтобы рендерить такие NACK'и
   * нейтрально (не красным) и метить строку бейджем `trace`.
   */
  observability?: boolean;
}

/** Событие. `kind` можно опустить — контракт без `kind` считается событием. */
export interface EventTopicContract<TName extends string = string, TPayload = unknown>
  extends TopicContractBase<TName, TPayload> {
  kind?: "event";
  /**
   * Сколько последних сообщений этого топика рантайм держит для подписчиков,
   * которые придут позже: `on(topic, fn, { replay: { limit } })`. Без поля
   * ничего не хранится — большинству событий это и не нужно.
   */
  retention?: { last: number };
}

/**
 * Запрос. Обязателен тип ответа — он попадает в `TopicResponses` и
 * подставляется в `request()` без явного `<…, R>`.
 */
export interface RequestTopicContract<
  TName extends string = string,
  TPayload = unknown,
  TResponse = unknown,
> extends TopicContractBase<TName, TPayload> {
  kind: "request";
  /** Тип ответа обработчика — объявляется через `as { ... }` */
  response: TResponse;
}

/**
 * Состояние. Рантайм удерживает последнее значение (`retention.last`,
 * пока поддерживается только `1`) и отдаёт его каждому новому подписчику.
 */
export interface StateTopicContract<TName extends string = string, TPayload = unknown>
  extends TopicContractBase<TName, TPayload> {
  kind: "state";
  /** Политика хранения. По умолчанию `{ last: 1 }`. */
  retention?: { last: 1 };
}

/**
 * Запись реестра для рантайма: то, что кодогенерация кладёт в `TOPIC_KINDS`
 * и хост передаёт в `initBroker({ topics: TOPIC_KINDS })` — род топика и,
 * если объявлено, retention.
 */
export interface TopicPolicy {
  kind: TopicKind;
  retention?: { last: number };
}

export type TopicContract<
  TName extends string = string,
  TPayload = unknown,
  TResponse = unknown,
> =
  | EventTopicContract<TName, TPayload>
  | RequestTopicContract<TName, TPayload, TResponse>
  | StateTopicContract<TName, TPayload>;

/**
 * Прежнее имя формы контракта. Совпадает с {@link TopicContract}: старые
 * файлы без `kind` продолжают проходить `satisfies` как события.
 * @deprecated Используйте `TopicContract`.
 */
export type EventContract<TName extends string = string, TPayload = unknown> = TopicContract<
  TName,
  TPayload,
  unknown
>;
