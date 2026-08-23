import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Минимальная форма одного контракта, которую DevTools требует от реестра.
 *
 * Совместима со shape'ом `EventContract` из `@hedwigjs/create-registry`,
 * но описана локально, чтобы DevTools не зависел от какого-либо
 * конкретного registry-пакета.
 */
export interface TopicContractInfo {
  /** Имя топика, например `"users.fetched.v1"`. */
  name: string;
  /** Человекочитаемое описание для UI. */
  description: string;
  /** Именованные фикстуры payload'а. Минимум — ключ `happy`. */
  examples?: Readonly<Record<string, unknown>>;
  /** Если событие deprecated — имя топика-наследника. */
  deprecatedBy?: string;
  /**
   * Топик — телеметрический (тrace/observability). У него по замыслу
   * может не быть business-подписчиков, поэтому `NACK NO_SUBSCRIBERS`
   * для него — ожидаемое состояние, не ошибка. DevTools использует
   * этот флаг чтобы рендерить такие NACK'и нейтрально.
   */
  observability?: boolean;
}

/**
 * Каталог топиков, индексированный по имени топика.
 * Передаётся в `MessageBrokerDevTools` через prop `registry`.
 */
export type TopicsRegistry = Readonly<Record<string, TopicContractInfo>>;

const TopicsRegistryContext = createContext<TopicsRegistry | null>(null);

export interface TopicsRegistryProviderProps {
  registry: TopicsRegistry | undefined;
  children: ReactNode;
}

export function TopicsRegistryProvider({
  registry,
  children,
}: TopicsRegistryProviderProps): ReactNode {
  return (
    <TopicsRegistryContext.Provider value={registry ?? null}>
      {children}
    </TopicsRegistryContext.Provider>
  );
}

/**
 * Хук для табов DevTools: возвращает реестр топиков, переданный
 * в `MessageBrokerDevTools`. `null` означает, что реестр не передан —
 * UI должен это корректно обработать (показать пустое состояние / disable
 * функциональность каталога).
 */
export function useTopicsRegistry(): TopicsRegistry | null {
  return useContext(TopicsRegistryContext);
}
