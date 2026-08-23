/**
 * Публичный API: корневой UI-компонент и типы пропсов.
 * Остальное (инспектор, attach) — внутренние детали пакета.
 */
export { MessageBrokerDevTools } from "./ui/MessageBrokerDevTools";
export type { MessageBrokerDevToolsProps, DevToolsPanelPosition } from "./ui/MessageBrokerDevTools";
export { useTopicsRegistry } from "./ui/topicsRegistry";
export type { TopicsRegistry, TopicContractInfo } from "./ui/topicsRegistry";
