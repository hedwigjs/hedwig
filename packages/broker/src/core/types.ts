import type { BrokerLogger } from './logger/BrokerLogger.types';
import type { ClientID, Message, SubscriptionOptions } from '@hedwigjs/client';

// ========================================
// PUBLIC TYPES — owned by @hedwigjs/client
// ========================================
//
// Everything a module can see is defined in the SDK package and re-exported
// here so host code and the runtime's own modules keep one import path.

export type {
  ClientID,
  Message,
  HandlerFn,
  MessageOptions,
  RequestOptions,
  ReplayOptions,
  SubscriptionOptions,
} from '@hedwigjs/client';

/**
 * Type-erased message handler for internal core usage.
 *
 * Same contract as HandlerFn but without generic type parameters.
 * Used in Broker, Subscriptions, Router, BackpressureHandler
 * where specific message/payload types are already erased.
 */
export type MessageHandler = (message: Message) => void | any | Promise<void | any>;

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
  /** Version of `@hedwigjs/client` that created the client, when it came through the SDK. */
  sdkVersion?: string;
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
