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
 * This is the extension point for cross-context transports. Built-in
 * implementations (`PostMessageTransport`, `BroadcastChannelTransport`,
 * `WebSocketTransport`, `SSETransport`) are exported from `@hedwigjs/broker`;
 * custom transports (WebRTC, Service Worker, Electron IPC, etc.) plug in by
 * implementing this interface — no other broker internals need to be touched.
 *
 * ## Contract
 *
 * ### Outbound — `send(data)`
 * Called by the {@link Bridge} whenever a local broker message matches the
 * bridge's forward patterns. Implementation must serialize (if needed) and
 * hand the payload to the underlying wire. Errors should be caught and
 * logged, not thrown — a failing wire must not crash the broker pipeline.
 *
 * ### Inbound — `onMessage(callback)`
 * Called once by the {@link Bridge} at construction time to subscribe to
 * incoming messages. Implementation must invoke `callback` for every valid
 * inbound payload after any transport-level validation (e.g. origin checks
 * for postMessage, channel filtering for BroadcastChannel). Returns an
 * unsubscribe function; the {@link Bridge} calls it in `destroy()`.
 *
 * ### Cleanup — `destroy()`
 * Called when the bridge is removed or the broker is destroyed. Must release
 * all resources (event listeners, sockets, channels). Must be idempotent.
 *
 * ## Security note
 *
 * Transports are the trust boundary between the broker and the outside
 * world. If your wire crosses origins (postMessage, WebSocket, SSE),
 * validate the source before invoking the inbound callback — the broker
 * will otherwise route whatever it receives.
 *
 * @example Custom transport skeleton
 * ```ts
 * class MyTransport implements BridgeTransport {
 *   #cb: ((data: unknown) => void) | null = null;
 *
 *   send(data: unknown): void {
 *     try { myWire.publish(data); }
 *     catch (e) { console.error('[MyTransport] send failed:', e); }
 *   }
 *
 *   onMessage(cb: (data: unknown) => void): () => void {
 *     this.#cb = cb;
 *     const off = myWire.subscribe((payload) => {
 *       if (!isTrusted(payload)) return;
 *       this.#cb?.(payload);
 *     });
 *     return () => { off(); this.#cb = null; };
 *   }
 *
 *   destroy(): void { this.#cb = null; myWire.close(); }
 * }
 * ```
 */
export interface BridgeTransport {
  /** Outbound: send a payload to the wire. See interface docs for contract. */
  send(data: unknown): void;

  /** Inbound: subscribe to payloads from the wire. Returns unsubscribe. */
  onMessage(callback: (data: unknown) => void): () => void;

  /** Release resources. Must be idempotent. */
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
