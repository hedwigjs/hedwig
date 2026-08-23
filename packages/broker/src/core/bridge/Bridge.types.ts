import type { ClientID, Message } from '../types';
import type { RoutingResult } from '../routing/RoutingResult';

/**
 * Callback that injects a message received from a transport into the broker
 * pipeline with `fromExternal = true`.
 *
 * Wired by {@link BrokerCore.addBridge} — Bridge receives only this capability,
 * not a reference to the full core.
 */
export type ExternalMessageInjector<
  T extends string,
  P extends Record<T, any>,
> = <K extends T>(
  topic: K,
  sender: ClientID,
  recipient: ClientID | '*',
  data: P[K],
) => Promise<RoutingResult>;

/**
 * Pluggable wire used by {@link BridgeConfig} / {@link MessageBroker.addBridge}.
 *
 * Built-in implementations (postMessage, BroadcastChannel, WebSocket) live
 * inside this package but are not exported — framework adapters (`@message-broker/adapter-*`)
 * construct them or supply their own objects that satisfy this interface.
 */
export interface BridgeTransport {
  send(data: unknown): void;
  onMessage(callback: (data: unknown) => void): () => void;
  destroy(): void;
}

/**
 * Bridge configuration
 */
export interface BridgeConfig {
  /** Low-level duplex link (see {@link BridgeTransport}) */
  transport: BridgeTransport;

  /** Message patterns to forward (e.g. ['user.*', 'theme.*']) */
  forward: string[];
}

/**
 * Bridge interface - transport layer for cross-context communication
 *
 * Bridge forwards messages
 * between broker and external contexts (iframes, tabs, servers).
 */
export interface Bridge {
  /** Topic patterns this bridge forwards to its transport. */
  readonly forwardPatterns: ReadonlyArray<string>;

  /**
   * Transport class name with the `Transport` suffix stripped
   * (e.g. `WebSocket`, `SSE`). Used only by the Inspector to label
   * bridges in DevTools. `undefined` for transports whose constructor
   * is an anonymous class.
   */
  readonly transportKind?: string;

  /**
   * Check if topic should be forwarded to transport
   */
  shouldForward(topic: string): boolean;

  /**
   * Send message to transport
   */
  send(message: Message): void;

  /**
   * Cleanup resources
   */
  destroy(): void;
}
