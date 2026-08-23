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

  /** Indicates if this message was received from external source (bridge) */
  fromExternal?: boolean;
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
   * Messages are replayed asynchronously after subscription is established.
   */
  replay?: ReplayOptions;
}

// ========================================
// CLIENT SNAPSHOT TYPES (for DevTools)
// ========================================

export interface ClientSubscriptionInfo {
  topic: string;
  /** Subscription options (backpressure, replay). */
  options?: SubscriptionOptions;
}

/** Point-in-time snapshot of a single registered client. */
export interface ClientInfo {
  id: ClientID;
  /** Unix timestamp (ms) when the client registered. */
  connectedAt: number;
  subscriptions: ClientSubscriptionInfo[];
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
}
