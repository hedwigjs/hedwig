import type { BrokerLogger } from './logger/BrokerLogger.types';
import type { ClientID, Message, SubscriptionOptions, TopicKindMap, TopicPolicy } from '@hedwigjs/client';

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
  TopicKind,
  TopicKindMap,
  TopicPolicy,
  TopicContractsMap,
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

/** The retained (last) value of a `state` topic. */
export interface RetainedState<T extends string = string, P = any> {
  topic: T;
  message: Message<T, P>;
  /** Unix ms when it was retained. */
  at: number;
}

/**
 * Configuration for Broker
 */
export interface BrokerConfig {
  /**
   * Host-side limits on retention. *What* is retained comes from the
   * contracts (`topics`): an event with `retention: { last: N }` keeps its
   * last N messages, a `state` topic keeps its last value. Nothing here is
   * required — a host that passes no `history` retains exactly what the
   * registry declares.
   */
  history?: {
    /**
     * Switch event retention off entirely (`replay` then finds nothing).
     * `state` topics keep their last value regardless.
     * @default true
     */
    enabled?: boolean;

    /** Upper bound on any event's declared `retention.last`. */
    maxPerTopic?: number;

    /** Time to live (ms) for retained event messages. State values never expire. */
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

  /**
   * The contracts registry as the runtime needs it (`TOPIC_KINDS`): each
   * topic's kind and, for events, an optional `retention`. `state` topics
   * keep their last multicast and hand it to every new subscriber on `on()`
   * (see `SubscriptionOptions.retained`); events with `retention.last`
   * keep that many recent messages for `on(topic, fn, { replay })`.
   * Requests need nothing from the runtime; their kind is enforced by the
   * SDK's types. Keys are exact topic names.
   */
  topics?: TopicKindMap;

  /**
   * What happens to the object a module passes as `data`.
   *
   * - `'freeze'` (default): it is deep-frozen **in place** before entering
   *   the pipeline — no copy, so nothing is paid on the hot path, but the
   *   emitter's own object is frozen afterwards. Emit a snapshot if you
   *   keep mutating the original.
   * - `'clone'`: it is copied with `structuredClone` first and the copy is
   *   frozen; the emitter keeps a mutable original. Costs one copy per
   *   message, and a payload `structuredClone` cannot copy (functions,
   *   class instances with methods, DOM nodes) is rejected with
   *   `NACK SERIALIZATION_FAILED`.
   *
   * Binary views (`ArrayBuffer`, typed arrays) are never frozen either way.
   */
  payloads?: 'freeze' | 'clone';
}
