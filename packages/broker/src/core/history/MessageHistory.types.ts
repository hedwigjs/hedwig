import type { Message, ClientID } from '../types';

/**
 * Entry in message history with metadata
 */
export interface HistoryEntry<T extends string = string, P = any> {
  /** The message itself (immutable) */
  message: Readonly<Message<T, P>>;

  /** Unix timestamp (ms) when message was recorded */
  timestamp: number;

  /** Sequence number for guaranteed ordering */
  sequence: number;
}

/**
 * Filter for querying message history
 */
export interface HistoryFilter<T extends string = string> {
  /** Topics to filter (supports glob patterns like 'user.*') */
  topics?: T[];

  /** Filter by event sources */
  sources?: ClientID[];

  /** Start timestamp (inclusive) */
  since?: number;

  /** End timestamp (inclusive) */
  until?: number;

  /** Maximum number of messages to return */
  limit?: number;
}

/**
 * Host-side limits on retention — see `BrokerConfig.history`.
 */
export interface HistoryConfig {
  /** Event retention on/off (default true). State retention is unaffected. */
  enabled?: boolean;

  /** Upper bound on any event's declared `retention.last`. */
  maxPerTopic?: number;

  /** Time to live (ms) for retained event messages. State values never expire. */
  ttl?: number;
}

/** One retained topic as declared by the registry, with its current fill. */
export interface RetentionInfo {
  topic: string;
  /** `state` keeps one value for every new subscriber; `event` keeps `limit` for `replay`. */
  kind: 'event' | 'state';
  /** How many messages the topic keeps (after the host's `maxPerTopic` cap). */
  limit: number;
  /** How many it holds right now. */
  count: number;
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
 * Statistics about message history
 */
export interface HistoryStats {
  /** Total number of messages retained across all topics */
  count: number;

  /** Every topic that retains messages (declared in the registry), with its fill. */
  topics: ReadonlyArray<RetentionInfo>;

  /** Unix timestamp (ms) of oldest message */
  oldestTimestamp?: number;

  /** Unix timestamp (ms) of newest message */
  newestTimestamp?: number;

  /** Memory usage estimate (bytes) */
  memoryUsage?: number;
}
