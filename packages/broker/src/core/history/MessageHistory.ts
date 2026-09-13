import type { Message } from '../types';
import type {
  HistoryEntry,
  HistoryFilter,
  HistoryConfig,
  HistoryStats,
  RetentionInfo,
} from './MessageHistory.types';
import { deepFreeze } from '../utils/deepFreeze';
import { matchPattern } from '../utils/matchPattern';

interface TopicBuffer<T extends string, P> {
  kind: 'event' | 'state';
  limit: number;
  entries: HistoryEntry<T, P>[];
}

/**
 * MessageHistory — retained messages, one bounded buffer per topic.
 *
 * What is retained is declared by the registry, not decided at the emit
 * site: `retain(topic, limit)` is called once per topic that has
 * `retention` in its contract (`state` topics with limit 1). A message on
 * any other topic is not recorded. Because every topic has its own ring,
 * a chatty topic can never evict another topic's messages.
 *
 * The host may cap event retention (`maxPerTopic`), expire it (`ttl`) or
 * switch it off (`enabled: false`); `state` buffers ignore all three.
 *
 * Entries are frozen and carry a global sequence number, so queries across
 * topics come back in emit order.
 */
export class MessageHistory<T extends string, P extends Record<T, any>> {
  #buffers = new Map<string, TopicBuffer<T, P[T]>>();
  #sequence = 0;
  readonly #enabled: boolean;
  readonly #maxPerTopic: number | undefined;
  readonly #ttl: number | undefined;
  #cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config?: HistoryConfig) {
    this.#enabled = config?.enabled ?? true;
    this.#maxPerTopic = config?.maxPerTopic;
    this.#ttl = config?.ttl;
    if (this.#ttl !== undefined) this.#startCleanup();
  }

  /** Whether event retention is on (the host's `history.enabled`). */
  get enabled(): boolean {
    return this.#enabled;
  }

  /**
   * Declare that `topic` keeps its last `limit` messages. Events are subject
   * to the host's `enabled` switch and `maxPerTopic` cap; a `state` topic
   * always keeps exactly one value.
   */
  retain(topic: string, limit: number, kind: 'event' | 'state' = 'event'): void {
    if (kind === 'event' && !this.#enabled) return;
    let effective = kind === 'state' ? 1 : Math.floor(limit);
    if (kind === 'event' && this.#maxPerTopic !== undefined) {
      effective = Math.min(effective, this.#maxPerTopic);
    }
    if (!Number.isFinite(effective) || effective < 1) return;
    const existing = this.#buffers.get(topic);
    if (existing) {
      existing.kind = kind;
      existing.limit = effective;
      this.#evict(existing);
      return;
    }
    this.#buffers.set(topic, { kind, limit: effective, entries: [] });
  }

  /** Whether `topic` (exact name) retains messages. */
  retains(topic: string): boolean {
    return this.#buffers.has(topic);
  }

  /** Whether at least one retaining topic matches `pattern` (exact name or glob). */
  retainsMatching(pattern: string): boolean {
    for (const topic of this.#buffers.keys()) {
      if (matchPattern(topic, pattern)) return true;
    }
    return false;
  }

  /**
   * Record a message on its topic's buffer. Returns `false` (and records
   * nothing) when the topic does not retain.
   *
   * Amortised O(1): the array is allowed to grow to twice the limit before
   * the stale head is cut off in one splice; readers only ever look at the
   * last `limit` entries (see {@link MessageHistory.live}).
   */
  record(message: Message<T, P[T]>): boolean {
    const buffer = this.#buffers.get(message.topic);
    if (!buffer) return false;
    buffer.entries.push({
      message: deepFreeze(message),
      timestamp: message.timestamp,
      sequence: this.#sequence++,
    });
    if (buffer.entries.length >= buffer.limit * 2) this.#evict(buffer);
    return true;
  }

  /** The entries a topic actually retains: the newest `limit` of its array. */
  static live<T extends string, P>(buffer: TopicBuffer<T, P>): HistoryEntry<T, P>[] {
    return buffer.entries.length > buffer.limit ? buffer.entries.slice(-buffer.limit) : buffer.entries;
  }

  /** The newest retained entry of `topic`, if any. */
  last(topic: string): HistoryEntry<T, P[T]> | undefined {
    const entries = this.#buffers.get(topic)?.entries;
    return entries && entries.length > 0 ? entries[entries.length - 1] : undefined;
  }

  /**
   * Query retained messages across topics, synchronously.
   *
   * Replay uses this so the snapshot is taken on the subscriber's own
   * stack — before `on()` returns and before any live message emitted
   * afterwards can land in a buffer. The returned array is a copy, in emit
   * order (sequence); `limit` keeps the newest N.
   */
  querySync(filter?: HistoryFilter<T>): HistoryEntry<T, P[T]>[] {
    let results: HistoryEntry<T, P[T]>[] = [];
    const patterns = filter?.topics;
    for (const [topic, buffer] of this.#buffers) {
      if (patterns && patterns.length > 0 && !patterns.some((p) => matchPattern(topic, p))) continue;
      results.push(...MessageHistory.live(buffer));
    }
    if (this.#buffers.size > 1) results.sort((a, b) => a.sequence - b.sequence);

    if (filter?.since !== undefined) {
      results = results.filter((entry) => entry.timestamp >= filter.since!);
    }
    if (filter?.until !== undefined) {
      results = results.filter((entry) => entry.timestamp <= filter.until!);
    }
    if (filter?.sources && filter.sources.length > 0) {
      results = results.filter((entry) => filter.sources!.includes(entry.message.source));
    }
    if (filter?.limit !== undefined && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }
    return results;
  }

  /** Thin async wrapper over {@link querySync}, kept for API compatibility. */
  async query(filter?: HistoryFilter<T>): Promise<HistoryEntry<T, P[T]>[]> {
    return this.querySync(filter);
  }

  /** Drop retained messages (all, or those matching `filter`). Buffers stay declared. */
  async clear(filter?: HistoryFilter<T>): Promise<void> {
    for (const [topic, buffer] of this.#buffers) {
      if (!filter) {
        buffer.entries = [];
        continue;
      }
      if (filter.topics && filter.topics.length > 0 && !filter.topics.some((p) => matchPattern(topic, p))) {
        continue;
      }
      buffer.entries = buffer.entries.filter((entry) => {
        if (filter.since !== undefined && entry.timestamp < filter.since) return true;
        if (filter.until !== undefined && entry.timestamp > filter.until) return true;
        if (filter.sources && filter.sources.length > 0 && !filter.sources.includes(entry.message.source)) {
          return true;
        }
        return false;
      });
    }
  }

  /** Every retained entry across topics, in emit order. */
  getSnapshot(): ReadonlyArray<HistoryEntry<T, P[T]>> {
    return this.querySync();
  }

  /** Declared topics with their fill, plus totals. */
  getStats(): HistoryStats {
    const topics: RetentionInfo[] = [];
    let count = 0;
    let oldest: number | undefined;
    let newest: number | undefined;
    for (const [topic, buffer] of this.#buffers) {
      const live = MessageHistory.live(buffer);
      topics.push({ topic, kind: buffer.kind, limit: buffer.limit, count: live.length });
      count += live.length;
      for (const entry of live) {
        if (oldest === undefined || entry.timestamp < oldest) oldest = entry.timestamp;
        if (newest === undefined || entry.timestamp > newest) newest = entry.timestamp;
      }
    }
    topics.sort((a, b) => a.topic.localeCompare(b.topic));
    if (count === 0) return { count: 0, topics };
    return { count, topics, oldestTimestamp: oldest, newestTimestamp: newest, memoryUsage: count * 100 };
  }

  /** Stop the TTL timer and forget every buffer. */
  destroy(): void {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = undefined;
    }
    this.#buffers.clear();
  }

  #evict(buffer: TopicBuffer<T, P[T]>): void {
    if (buffer.entries.length > buffer.limit) {
      buffer.entries.splice(0, buffer.entries.length - buffer.limit);
    }
  }

  /** Periodic TTL cleanup — event buffers only; state values never expire. */
  #startCleanup(): void {
    const ttl = this.#ttl;
    if (!ttl) return;
    const interval = Math.min(ttl / 2, 60000);
    this.#cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - ttl;
      for (const buffer of this.#buffers.values()) {
        if (buffer.kind !== 'event') continue;
        buffer.entries = buffer.entries.filter((entry) => entry.timestamp > cutoff);
      }
    }, interval);
    // Never keep a process alive just to expire retained messages.
    (this.#cleanupTimer as { unref?: () => void }).unref?.();
  }
}
