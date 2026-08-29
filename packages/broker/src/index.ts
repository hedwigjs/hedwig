/**
 * @hedwigjs/broker
 *
 * Public API of the message broker.
 *
 * Typical usage:
 *   - Host/shell boots the broker: `initBroker(config)`.
 *   - Each microfrontend creates a client: `createClient(id)`.
 *   - Debug tooling accesses the broker: `getBroker()`.
 *
 * Built-in transports (PostMessage, BroadcastChannel, WebSocket, SSE) are
 * exported from this package for zero-config integrations. Framework
 * adapters (`@hedwigjs/adapter-*`) may re-export or wrap them. Custom
 * transports plug in via the {@link BridgeTransport} extension point —
 * see the "Custom transports" section in the README.
 */

// ── Entry points ────────────────────────────────────────────────────────
export { initBroker, createClient, getBroker, destroyBroker } from './facade';

// ── Broker & Client contracts (public) ──────────────────────────────────
export type { MessageBroker } from './core/MessageBroker';
export type { Client } from './core/client/Client.types';

// ── Configuration ───────────────────────────────────────────────────────
export type {
  BrokerConfig,
  Message,
  ClientID,
  HandlerFn,
  MessageHandler,
  MessageOptions,
  SubscriptionOptions,
  ReplayOptions,
  ClientInfo,
  ClientSubscriptionInfo,
} from './core/types';

// ── Extension points (adapters / plugins) ───────────────────────────────
export type {
  OnSubscribeHook,
  BeforeSendHook,
  AfterSendHook,
  HookResult,
} from './core/hooks/HooksRegistry.types';

// ── Routing result (surfaced by hooks & DevTools) ───────────────────────
export { RoutingReason } from './core/routing/RoutingResult';
export type { RoutingResult, RoutingReasonType } from './core/routing/RoutingResult';

// ── Observability (tooling: DevTools, tracing, metrics) ─────────────────
export type {
  SystemEventsEmitter,
  SystemEventMap,
  SystemEventName,
  SystemEventPayload,
  SystemEventListener,
  SystemAnyEventListener,
} from './core/events/SystemEvents.types';
export type { Inspector } from './core/observability/inspect/Inspector';
export type { BridgeInfo } from './core/observability/inspect/Inspector.types';

// ── History inspection ──────────────────────────────────────────────────
export type { HistoryEntry, HistoryStats } from './core/history/MessageHistory.types';

// ── Bridge extension point ──────────────────────────────────────────────
export type { BridgeTransport, BridgeConfig } from './core/bridge/Bridge.types';

// ── Built-in transports ─────────────────────────────────────────────────
// Ready-to-use implementations for the common cross-context wires. Kept
// here for zero-config demo integrations; framework-specific adapters
// (`@hedwigjs/adapter-*`) may re-export or wrap these.
export {
  PostMessageTransport,
  type PostMessageTransportConfig,
} from './transports/PostMessageTransport';
export {
  BroadcastChannelTransport,
} from './transports/BroadcastChannelTransport';
export {
  WebSocketTransport,
} from './transports/WebSocketTransport';
export {
  SSETransport,
  type SSETransportConfig,
} from './transports/SSETransport';

// ── Backpressure configuration ──────────────────────────────────────────
export type { BackpressureOptions } from './core/backpressure/BackpressureHandler.types';

// ── Logger (pluggable infrastructure logger) ────────────────────────────
export type { BrokerLogger, BrokerLogEvent } from './core/logger/BrokerLogger.types';
export { defaultLogger } from './core/logger/BrokerLogger.types';
