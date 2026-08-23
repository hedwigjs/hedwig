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
 * Configuration for message history
 */
export interface HistoryConfig {
  /** Enable message history */
  enabled: boolean;

  /** Maximum number of messages to keep in memory (default: 1000) */
  maxSize?: number;

  /** Time to live for messages (ms). undefined = no expiration */
  ttl?: number;
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
  /** Total number of messages in history */
  count: number;

  /** Unix timestamp (ms) of oldest message */
  oldestTimestamp?: number;

  /** Unix timestamp (ms) of newest message */
  newestTimestamp?: number;

  /** Memory usage estimate (bytes) */
  memoryUsage?: number;
}
