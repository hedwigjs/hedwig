/**
 * Форма контракта одного события.
 * Используется через `satisfies` в файлах domains/.
 *
 * Этот файл копируется initializer'ом в org-package при создании реестра.
 * После copy редактирование не предполагается.
 */
export interface EventContract<
  TName extends string = string,
  TPayload = unknown,
> {
  /** Имя топика, формат: <domain>.<action>.v<N> */
  name: TName;

  /** Описание для DevTools и команды */
  description: string;

  /** Тип payload — объявляется через `as { ... }` */
  payload: TPayload;

  /** Фикстуры для тестов и DevTools-имитации. Минимум — ключ `happy` */
  examples: Record<string, TPayload>;

  /** Если событие deprecated — указатель на новую версию */
  deprecatedBy?: string;
}
