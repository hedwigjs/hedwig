import type { ClientID, MessageHandler, SubscriptionOptions } from '../types';

/**
 * Subscriptions - Efficient subscription and handler management
 *
 * A single `(clientId, topic)` pair may hold MANY handlers. Each individual
 * subscription is identified by a monotonic numeric id returned from
 * {@link subscribe}, so callers can remove one handler without touching the
 * others. Bulk operations (`unsubscribe(clientId, topic)`,
 * `unsubscribeAll(clientId)`) still nuke every handler in scope.
 *
 * Bidirectional indexes for O(1) lookups:
 * - Topic → Clients mapping (multicast recipient lookup — a client appears
 *   once no matter how many handlers it registered)
 * - Client → Topics mapping (unsubscribe fan-out)
 * - Composite key → ordered handler entries
 * - Subscription id → location (for O(1) per-handler removal)
 *
 * @internal This class is used internally by BrokerCore and Router
 */

/** Opaque handle returned by {@link Subscriptions.subscribe}. */
export type SubscriptionId = number;

export type SubscriptionEntry = {
  readonly id: SubscriptionId;
  readonly handler: MessageHandler;
  readonly options?: SubscriptionOptions;
};

export class Subscriptions<T extends string> {
  // ========================================
  // BIDIRECTIONAL INDEXES FOR O(1) OPERATIONS
  // ========================================

  /** Topic → Clients mapping for fast multicast recipient lookup */
  #subscriptions = new Map<T, Set<ClientID>>();

  /** Client → Topics mapping for fast unsubscribe operations */
  #clientSubscriptions = new Map<ClientID, Set<T>>();

  /** Composite key → ordered handler entries (many per pair). */
  #entries = new Map<string, SubscriptionEntry[]>();

  /** Subscription id → its location, for O(1) single-handler removal. */
  #entryLocations = new Map<SubscriptionId, { clientId: ClientID; topic: T }>();

  /** Monotonic subscription id counter. */
  #nextId: SubscriptionId = 1;

  /** Shared empty set to avoid allocations */
  readonly #emptySet: ReadonlySet<ClientID> = Object.freeze(new Set<ClientID>());
  readonly #emptyEntries: readonly SubscriptionEntry[] = Object.freeze([]);

  // ========================================
  // SUBSCRIPTION OPERATIONS
  // ========================================

  /**
   * Reserve a subscription id ahead of {@link subscribe}.
   *
   * Callers that need the id BEFORE the handler is finalized (e.g. to key
   * a backpressure strategy by that id) can pre-allocate here and then
   * pass the reserved id to {@link subscribe}.
   */
  reserveId(): SubscriptionId {
    return this.#nextId++;
  }

  /**
   * Subscribe a handler to a (client, topic) pair.
   *
   * Appends a new entry — previously registered handlers on the same pair
   * are preserved. Returns the subscription id so the caller can remove
   * this specific handler later via {@link unsubscribeOne}.
   *
   * If `preReservedId` is provided (from {@link reserveId}), that id is
   * used instead of generating a new one.
   */
  subscribe(
    clientId: ClientID,
    topic: T,
    handler: MessageHandler,
    options?: SubscriptionOptions,
    preReservedId?: SubscriptionId,
  ): SubscriptionId {
    if (!this.#subscriptions.has(topic)) {
      this.#subscriptions.set(topic, new Set());
    }
    this.#subscriptions.get(topic)!.add(clientId);

    if (!this.#clientSubscriptions.has(clientId)) {
      this.#clientSubscriptions.set(clientId, new Set());
    }
    this.#clientSubscriptions.get(clientId)!.add(topic);

    const id: SubscriptionId = preReservedId ?? this.#nextId++;
    const entry: SubscriptionEntry = { id, handler, options };

    const key = this.#getKey(clientId, topic);
    let list = this.#entries.get(key);
    if (!list) {
      list = [];
      this.#entries.set(key, list);
    }
    list.push(entry);

    this.#entryLocations.set(id, { clientId, topic });

    return id;
  }

  /**
   * Remove a single handler by its subscription id.
   *
   * If this was the last handler for the pair, the pair is fully removed
   * from the bidirectional indexes (mirroring `unsubscribe` semantics).
   *
   * @returns Removal outcome: the removed entry, the pair it belonged to,
   *          and whether it was the last handler on that pair. `undefined`
   *          when no such id existed.
   */
  unsubscribeOne(id: SubscriptionId):
    | {
        entry: SubscriptionEntry;
        clientId: ClientID;
        topic: T;
        wasLast: boolean;
      }
    | undefined {
    const location = this.#entryLocations.get(id);
    if (!location) return undefined;

    const { clientId, topic } = location;
    const key = this.#getKey(clientId, topic);
    const list = this.#entries.get(key);
    if (!list) {
      this.#entryLocations.delete(id);
      return undefined;
    }

    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) {
      this.#entryLocations.delete(id);
      return undefined;
    }

    const [removed] = list.splice(idx, 1);
    this.#entryLocations.delete(id);

    const wasLast = list.length === 0;
    if (wasLast) {
      this.#entries.delete(key);
      this.#subscriptions.get(topic)?.delete(clientId);
      this.#clientSubscriptions.get(clientId)?.delete(topic);

      if (this.#subscriptions.get(topic)?.size === 0) {
        this.#subscriptions.delete(topic);
      }
    }

    return { entry: removed, clientId, topic, wasLast };
  }

  /**
   * Unsubscribe every handler a client holds on a topic.
   *
   * @returns Entries that were actually removed. Empty when the client had
   *          no handlers on the topic. Callers use this to release
   *          per-handler resources (e.g. backpressure strategies).
   */
  unsubscribe(clientId: ClientID, topic: T): readonly SubscriptionEntry[] {
    const key = this.#getKey(clientId, topic);
    const list = this.#entries.get(key);
    if (!list || list.length === 0) return this.#emptyEntries;

    for (const entry of list) {
      this.#entryLocations.delete(entry.id);
    }
    this.#entries.delete(key);

    this.#subscriptions.get(topic)?.delete(clientId);
    this.#clientSubscriptions.get(clientId)?.delete(topic);

    if (this.#subscriptions.get(topic)?.size === 0) {
      this.#subscriptions.delete(topic);
    }

    return list;
  }

  /**
   * Remove every subscription held by a given client.
   *
   * @returns Per-topic entry buckets that were removed, in iteration order.
   *          Empty when the client had no active subscriptions. Callers use
   *          this to release per-handler resources and emit per-topic
   *          `subscription.removed` events.
   */
  unsubscribeAll(
    clientId: ClientID,
  ): ReadonlyArray<{ topic: T; entries: readonly SubscriptionEntry[] }> {
    const clientTopics = this.#clientSubscriptions.get(clientId);
    if (!clientTopics || clientTopics.size === 0) {
      this.#clientSubscriptions.delete(clientId);
      return [];
    }

    const removed: Array<{ topic: T; entries: readonly SubscriptionEntry[] }> = [];
    for (const topic of clientTopics) {
      const key = this.#getKey(clientId, topic);
      const list = this.#entries.get(key);
      if (list) {
        for (const entry of list) {
          this.#entryLocations.delete(entry.id);
        }
        this.#entries.delete(key);
        removed.push({ topic, entries: list });
      }

      this.#subscriptions.get(topic)?.delete(clientId);
      if (this.#subscriptions.get(topic)?.size === 0) {
        this.#subscriptions.delete(topic);
      }
    }

    this.#clientSubscriptions.delete(clientId);
    return removed;
  }

  // ========================================
  // QUERY OPERATIONS
  // ========================================

  /**
   * Get all topics a client is subscribed to
   */
  getClientTopics(clientId: ClientID): ReadonlySet<T> | undefined {
    return this.#clientSubscriptions.get(clientId);
  }

  /**
   * Check if a client has at least one handler on a topic.
   */
  isSubscribed(clientId: ClientID, topic: T): boolean {
    return this.#clientSubscriptions.get(clientId)?.has(topic) ?? false;
  }

  /**
   * All handler entries a client has on a topic, in registration order.
   */
  getEntries(clientId: ClientID, topic: T): readonly SubscriptionEntry[] {
    return this.#entries.get(this.#getKey(clientId, topic)) ?? this.#emptyEntries;
  }

  /**
   * Options of the first handler registered on `(clientId, topic)`.
   *
   * Convenience for read-only observers (e.g. Inspector) that predate the
   * multi-handler model and expect a single options blob per pair.
   */
  getFirstOptions(clientId: ClientID, topic: T): SubscriptionOptions | undefined {
    return this.#entries.get(this.#getKey(clientId, topic))?.[0]?.options;
  }

  /**
   * Number of handlers a client holds on a topic (0 = not subscribed).
   */
  getHandlerCount(clientId: ClientID, topic: T): number {
    return this.#entries.get(this.#getKey(clientId, topic))?.length ?? 0;
  }

  /**
   * Get all subscribers for a topic (read-only)
   */
  getSubscribers(topic: T): ReadonlySet<ClientID> {
    return this.#subscriptions.get(topic) ?? this.#emptySet;
  }

  /**
   * Get list of all clients that have active subscriptions
   */
  getAllSubscribedClients(): ClientID[] {
    return Array.from(this.#clientSubscriptions.keys());
  }

  /**
   * Get detailed subscription map for all clients
   */
  getAllSubscriptions(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [clientId, topics] of this.#clientSubscriptions) {
      result[clientId] = Array.from(topics);
    }
    return result;
  }

  // ========================================
  // LIFECYCLE
  // ========================================

  /**
   * Clear all subscriptions and handlers.
   *
   * @returns All entries that were held, so the caller can release
   *          per-handler resources (e.g. backpressure strategies).
   */
  clear(): readonly SubscriptionEntry[] {
    const all: SubscriptionEntry[] = [];
    for (const list of this.#entries.values()) {
      for (const entry of list) {
        all.push(entry);
      }
    }
    this.#subscriptions.clear();
    this.#clientSubscriptions.clear();
    this.#entries.clear();
    this.#entryLocations.clear();
    return all;
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  #getKey(clientId: ClientID, topic: T): string {
    return `${clientId}:${topic}`;
  }
}
