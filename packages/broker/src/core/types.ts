import type { BackpressureOptions } from './backpressure/BackpressureHandler.types';
import type { BrokerLogger } from './logger/BrokerLogger.types';

// ========================================
// BASE TYPES (shared across all subsystems)
// ========================================

/** Unique client identifier in the system */
export type ClientID = string;

/**
 * Internal message format for inter-module communication
 */
export interface Message<T extends string = string, P = any> {
  /** Unique message identifier (e.g. "abc-42") for debugging and DevTools */
  id: string;

  /** Message topic (e.g. 'user.login.v1') */
  topic: T;

  /** Message source - client ID that emitted the message */
  source: string;

  /** Target client ID or '*' for broadcast */
  target: string;

  /** Message payload data */
  data: P;

  /** Unix timestamp in milliseconds */
  timestamp: number;

  /** Indicates if this is a replayed historical message */
  replayed?: boolean;

  /** True when the message was injected by a remote client (see `via`). */
  fromExternal?: boolean;

  /**
   * Id of the remote client whose transport delivered this message. Set by
   * the runtime, never by the peer; local-only, never on the wire. Hooks
   * and ACLs may key on it.
   */
  via?: string;

  /**
   * The producer's frame id when the message came over a wire. Together
   * with `source` it is the cross-realm correlation key; the local `id` is
   * this runtime's own. Local-only, never re-sent.
   */
  wireId?: string;

  /**
   * Opaque extension block carried by the frame (`ext.traceparent`,
   * `ext.hedwig.*`). Passed through untouched; local-only.
   */
  ext?: Readonly<Record<string, unknown>>;

  /**
   * Marks a debug/test message injected via `broker.$debug.send(...)`.
   * Routing, hooks, history and forwarding all treat it as a
   * real message — the flag is purely metadata so DevTools and integration
   * tests can distinguish spoofed traffic from production events.
   */
  synthetic?: boolean;
}

/**
 * Message handler function
 * Can return data for Request-Reply pattern
 */
export type HandlerFn<T extends string, P = unknown> = (
  message: Message<T, P>,
) => void | any | Promise<void | any>;

/**
 * Type-erased message handler for internal core usage
 *
 * Same contract as HandlerFn but without generic type parameters.
 * Used in Broker, Subscriptions, Router, BackpressureHandler
 * where specific message/payload types are already erased.
 */
export type MessageHandler = (message: Message) => void | any | Promise<void | any>;

// ========================================
// MESSAGE AND SUBSCRIPTION OPTIONS
// ========================================

/**
 * Options for message emission and requests
 */
export interface MessageOptions {
  /**
   * Record this message to history for replay
   *
   * Important: History has limited capacity (default 1000 messages).
   * Only mark truly important messages that late subscribers need to replay.
   *
   * @default false
   */
  history?: boolean;
}

/**
 * Options for `request()` — everything from {@link MessageOptions} plus a
 * per-call timeout.
 */
export interface RequestOptions extends MessageOptions {
  /**
   * Maximum time (ms) to wait for the recipient's handler. On expiry the
   * request resolves `NACK TIMEOUT`; the handler is NOT cancelled and may
   * still complete on its own. Overrides `BrokerConfig.request.timeout`.
   * `undefined` = wait forever.
   */
  timeout?: number;
}

/**
 * Options for replaying historical messages
 */
export interface ReplayOptions {
  /**
   * Maximum number of historical messages to replay
   * If not specified, replays all matching messages
   */
  limit?: number;

  /**
   * Replay messages starting from this timestamp (Unix ms)
   */
  since?: number;

  /**
   * Replay messages until this timestamp (Unix ms)
   */
  until?: number;
}

/**
 * Options for message subscription
 *
 * Controls how messages are processed and delivered to handlers.
 * All options are opt-in and can be combined.
 */
export interface SubscriptionOptions {
  /**
   * Backpressure control strategies for incoming messages
   *
   * Controls the rate and manner of message processing to prevent
   * UI freezing and optimize performance.
   */
  backpressure?: BackpressureOptions;

  /**
   * Replay historical messages when subscribing
   *
   * Allows late subscribers to catch up on missed messages.
   *
   * Replay is synchronous: matching entries are delivered to the handler
   * before `on()` returns, oldest first. Any live message emitted after
   * `on()` returns therefore arrives after the replayed ones, and a message
   * is never delivered twice (once live, once replayed).
   */
  replay?: ReplayOptions;

  /**
   * Exclude the subscriber's own emits from this subscription.
   *
   * `true` (default): a client never receives a multicast it emitted itself
   * — the long-standing broker behaviour. `false`: the client's own emits
   * are delivered to this handler too, like any other subscriber's. Same
   * idea as MQTT 5 "No Local". Only affects `emit()`; `request()` to
   * yourself always works.
   *
   * @default true
   */
  noLocal?: boolean;
}

// ========================================
// CLIENT SNAPSHOT TYPES (for DevTools)
// ========================================

export interface ClientSubscriptionInfo {
  topic: string;
  /**
   * Options of the first handler registered on this (client, topic) pair.
   * A pair may hold multiple handlers, each with distinct options — this
   * field surfaces one representative set for observability tools that
   * predate the multi-handler model.
   */
  options?: SubscriptionOptions;
  /** Total number of handlers this client has attached to the topic. */
  handlerCount: number;
}

/** Remote-side details of a client that lives behind a transport. */
export interface RemoteClientInfo {
  kind: string;
  identity: 'fixed' | 'allow' | 'prefix';
  duplex: boolean;
  fanout: boolean;
  requests: boolean;
  /** Topics the remote may inject. */
  accepts: string[];
  /** Requests in flight to the remote. */
  pending: number;
}

/** Point-in-time snapshot of a single registered client. */
export interface ClientInfo {
  id: ClientID;
  /** Unix timestamp (ms) when the client registered. */
  connectedAt: number;
  /** Local: exact topics with handlers. Remote: `forward` patterns. */
  subscriptions: ClientSubscriptionInfo[];
  /** Present for remote clients only. */
  remote?: RemoteClientInfo;
}

/**
 * Configuration for Broker
 */
export interface BrokerConfig {
  /** Message history configuration */
  history?: {
    /** Enable message history */
    enabled: boolean;

    /** Maximum number of messages to keep in memory (default: 1000) */
    maxSize?: number;

    /** Time to live for messages (ms). undefined = no expiration */
    ttl?: number;
  };

  /**
   * Pluggable logger for broker infrastructure events.
   *
   * Receives structured event codes (e.g. `'handler.failed'`) and a metadata
   * object. Use this to redirect broker warnings and errors to your
   * observability stack (Sentry, Datadog, pino, etc.).
   *
   * Defaults to `console.warn` / `console.error` when not provided.
   */
  logger?: BrokerLogger;

  /**
   * Enable the broker-internal debug channel (`broker.$debug.send`).
   *
   * The channel injects messages with an arbitrary `source`, bypassing
   * client identity — it exists for the DevTools Debug tab and integration
   * tests. Off by default so a production bundle cannot inject spoofed
   * traffic by accident; when off, `$debug.send` resolves
   * `NACK DEBUG_DISABLED` and logs `debug.disabled`.
   *
   * This is accident prevention, not a security boundary: any code in the
   * same realm can reach the broker regardless. See the threat-model doc.
   *
   * @default false
   */
  debug?: boolean;

  /**
   * Behaviour of guard hooks (`beforeSend`, `onSubscribe`) when a hook
   * throws instead of returning a result.
   *
   * - `'closed'` (default): the throwing hook counts as a denial — the
   *   message resolves `NACK HOOK_REJECTED`, the subscription throws. A
   *   crashing ACL must not let traffic through.
   * - `'open'`: the error is logged and the hook is skipped (the behaviour
   *   before 0.2).
   *
   * Either way a `hook.failed` system event and a `hook.failed` log line
   * are produced. Observer hooks (`afterSend`) are always isolated.
   */
  hooks?: {
    failMode?: 'open' | 'closed';
  };

  /**
   * Defaults for `request()`.
   */
  request?: {
    /** Default timeout (ms) for every request; see {@link RequestOptions.timeout}. */
    timeout?: number;
  };
}
