import type { Message } from '../types';
import type {
  HistoryEntry,
  HistoryFilter,
  HistoryConfig,
  HistoryStats,
} from './MessageHistory.types';
import { deepFreeze } from '../utils/deepFreeze';
import { matchPattern } from '../utils/matchPattern';

/**
 * MessageHistory - In-memory message history
 *
 * Features:
 * - FIFO eviction when maxSize is reached
 * - TTL-based automatic cleanup
 * - Glob pattern matching for topics
 * - Immutable messages (deepFreeze)
 * - Efficient filtering
 */
export class MessageHistory<T extends string, P extends Record<T, any>> {
  #entries: HistoryEntry<T, P[T]>[] = [];
  #sequence = 0;
  #config: Required<HistoryConfig>;
  #cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: HistoryConfig) {
    // Apply defaults for optional fields
    this.#config = {
      enabled: config.enabled,
      maxSize: config.maxSize ?? 1000,
      ttl: config.ttl,
    } as Required<HistoryConfig>;

    // Start TTL cleanup if configured
    if (this.#config.ttl !== undefined) {
      this.#startCleanup();
    }
  }

  /**
   * Record a message to history
   */
  record(message: Message<T, P[T]>): void {
    const entry: HistoryEntry<T, P[T]> = {
      message: deepFreeze(message),
      timestamp: message.timestamp,
      sequence: this.#sequence++,
    };

    this.#entries.push(entry);

    // FIFO eviction if maxSize exceeded
    if (this.#entries.length > this.#config.maxSize) {
      this.#entries.shift();
    }
  }

  /**
   * Query messages from history
   */
  async query(filter?: HistoryFilter<T>): Promise<HistoryEntry<T, P[T]>[]> {
    let results = [...this.#entries];

    // Filter by time range (since, until)
    if (filter?.since !== undefined) {
      results = results.filter((entry) => entry.timestamp >= filter.since!);
    }
    if (filter?.until !== undefined) {
      results = results.filter((entry) => entry.timestamp <= filter.until!);
    }

    // Filter by topics (supports glob patterns)
    if (filter?.topics && filter.topics.length > 0) {
      results = results.filter((entry) =>
        filter.topics!.some((pattern) => matchPattern(entry.message.topic, pattern)),
      );
    }

    // Filter by sources
    if (filter?.sources && filter.sources.length > 0) {
      results = results.filter((entry) => filter.sources!.includes(entry.message.source));
    }

    // Apply limit (last N messages)
    if (filter?.limit !== undefined && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Clear messages from history
   */
  async clear(filter?: HistoryFilter<T>): Promise<void> {
    if (!filter) {
      // Clear all
      this.#entries = [];
      return;
    }

    // Clear filtered entries
    const toKeep = await this.#getInverseFilter(filter);
    this.#entries = toKeep;
  }

  /**
   * Return a point-in-time snapshot of all entries (oldest → newest).
   */
  getSnapshot(): ReadonlyArray<HistoryEntry<T, P[T]>> {
    return [...this.#entries];
  }

  /**
   * Get history statistics
   */
  getStats(): HistoryStats {
    const count = this.#entries.length;

    if (count === 0) {
      return { count: 0 };
    }

    const oldestTimestamp = this.#entries[0]?.timestamp;
    const newestTimestamp = this.#entries[count - 1]?.timestamp;
    const memoryUsage = this.#estimateMemoryUsage();

    return {
      count,
      oldestTimestamp,
      newestTimestamp,
      memoryUsage,
    };
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = undefined;
    }
    this.#entries = [];
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  /**
   * Get entries that should be kept (inverse of filter)
   */
  async #getInverseFilter(filter: HistoryFilter<T>): Promise<HistoryEntry<T, P[T]>[]> {
    return this.#entries.filter((entry) => {
      // Keep if outside time range
      if (filter.since !== undefined && entry.timestamp < filter.since) {
        return true;
      }
      if (filter.until !== undefined && entry.timestamp > filter.until) {
        return true;
      }

      // Keep if topic doesn't match
      if (filter.topics && filter.topics.length > 0) {
        const matches = filter.topics.some((pattern) =>
          matchPattern(entry.message.topic, pattern),
        );
        if (!matches) {
          return true;
        }
      }

      // Keep if source doesn't match
      if (filter.sources && filter.sources.length > 0) {
        if (!filter.sources.includes(entry.message.source)) {
          return true;
        }
      }

      // Don't keep (should be cleared)
      return false;
    });
  }

  /**
   * Start periodic TTL-based cleanup
   */
  #startCleanup(): void {
    const ttl = this.#config.ttl;
    if (!ttl) return;

    // Run cleanup every TTL/2 (or every minute, whichever is smaller)
    const interval = Math.min(ttl / 2, 60000);

    this.#cleanupTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - ttl;

      // Remove messages older than TTL
      this.#entries = this.#entries.filter((entry) => entry.timestamp > cutoff);
    }, interval);
  }

  /**
   * Estimate memory usage (rough approximation)
   */
  #estimateMemoryUsage(): number {
    return this.#entries.length * 100;
  }
}
