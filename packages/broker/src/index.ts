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
 * Participants behind a wire (a backend over WebSocket, an iframe over
 * postMessage, another tab over BroadcastChannel) join as remote clients:
 * `createRemoteClient(id, { transport, … })`. Built-in transports are
 * named by descriptor (`{ kind: 'websocket', socket }`) and instantiated
 * by the runtime; custom ones implement the {@link Transport} interface —
 * see the "Remote clients" section in the README.
 */

// ── Entry points ────────────────────────────────────────────────────────
export { initBroker, createClient, createRemoteClient, getBroker, destroyBroker } from './facade';

// ── Package version (realm singleton compatibility, DevTools handshake) ──
export { VERSION, isCompatibleVersion } from './core/version';

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
  RequestOptions,
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
export type { VersionInfo } from './core/observability/inspect/Inspector.types';

// ── History inspection ──────────────────────────────────────────────────
export type { HistoryEntry, HistoryStats } from './core/history/MessageHistory.types';

// ── Remote clients & transports ─────────────────────────────────────────
export type {
  RemoteClient,
  RemoteClientOptions,
  RemoteIdentity,
  RemoteFrameRejectReason,
} from './core/remote/RemoteClient.types';
export type {
  Transport,
  TransportDescriptor,
  TransportKind,
} from './core/transport/Transport.types';
export type { RemoteClientInfo } from './core/types';

// Built-in transports are not exported: the runtime instantiates them from
// a `TransportDescriptor` so their code never ships in a module's bundle.
// Custom wires implement the `Transport` interface above.

// ── Backpressure configuration ──────────────────────────────────────────
export type { BackpressureOptions } from './core/backpressure/BackpressureHandler.types';

// ── Logger (pluggable infrastructure logger) ────────────────────────────
export type { BrokerLogger, BrokerLogEvent } from './core/logger/BrokerLogger.types';
export { defaultLogger } from './core/logger/BrokerLogger.types';
