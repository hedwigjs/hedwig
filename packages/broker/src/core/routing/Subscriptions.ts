import type { ClientID, MessageHandler, SubscriptionOptions } from '../types';

/**
 * Subscriptions - Efficient subscription and handler management
 *
 * Manages client subscriptions to topics with O(1) lookups using bidirectional indexes:
 * - Topic → Clients mapping for fast multicast recipient lookup
 * - Client → Topics mapping for fast unsubscribe operations
 * - Centralized handler storage with composite keys
 * - Backpressure options storage
 *
 * @internal This class is used internally by BrokerCore and Router
 */
export class Subscriptions<T extends string> {
  // ========================================
  // BIDIRECTIONAL INDEXES FOR O(1) OPERATIONS
  // ========================================

  /** Topic → Clients mapping for fast multicast recipient lookup */
  #subscriptions = new Map<T, Set<ClientID>>();

  /** Client → Topics mapping for fast unsubscribe operations */
  #clientSubscriptions = new Map<ClientID, Set<T>>();

  /** Centralized handler storage with composite keys */
  #handlers = new Map<string, MessageHandler>();

  /** Backpressure options storage */
  #handlerOptions = new Map<string, SubscriptionOptions>();

  /** Shared empty set to avoid allocations */
  readonly #emptySet: ReadonlySet<ClientID> = Object.freeze(new Set<ClientID>());

  // ========================================
  // SUBSCRIPTION OPERATIONS
  // ========================================

  /**
   * Subscribe a client to a topic
   *
   * Maintains bidirectional indexes for O(1) lookups:
   * - Adds client to topic's subscriber set
   * - Adds topic to client's subscription set
   * - Stores handler with composite key
   * - Stores backpressure options (if provided)
   *
   * Note: Only one handler per client per topic.
   * Subsequent subscriptions will replace the previous handler.
   *
   * @param clientId - Unique client identifier
   * @param topic - Topic to subscribe to
   * @param handler - Message handler function
   * @param options - Backpressure options (optional)
   */
  subscribe(
    clientId: ClientID,
    topic: T,
    handler: MessageHandler,
    options?: SubscriptionOptions,
  ): void {
    if (!this.#subscriptions.has(topic)) {
      this.#subscriptions.set(topic, new Set());
    }
    this.#subscriptions.get(topic)!.add(clientId);

    if (!this.#clientSubscriptions.has(clientId)) {
      this.#clientSubscriptions.set(clientId, new Set());
    }
    this.#clientSubscriptions.get(clientId)!.add(topic);

    const handlerKey = this.#getHandlerKey(clientId, topic);
    this.#handlers.set(handlerKey, handler);

    // Store backpressure options if provided
    if (options) {
      this.#handlerOptions.set(handlerKey, options);
    }
  }

  /**
   * Unsubscribe a client from a topic
   *
   * Removes the subscription and cleans up empty entries.
   *
   * @param clientId - Unique client identifier
   * @param topic - Topic to unsubscribe from
   * @returns `true` if a subscription actually existed and was removed,
   *          `false` if there was nothing to remove (no-op). Callers use
   *          this to decide whether to emit `subscription.removed` without
   *          an extra pre-read of the state.
   */
  unsubscribe(clientId: ClientID, topic: T): boolean {
    const existed = this.#clientSubscriptions.get(clientId)?.has(topic) ?? false;
    if (!existed) return false;

    this.#subscriptions.get(topic)?.delete(clientId);
    this.#clientSubscriptions.get(clientId)?.delete(topic);

    const handlerKey = this.#getHandlerKey(clientId, topic);
    this.#handlers.delete(handlerKey);
    this.#handlerOptions.delete(handlerKey);

    if (this.#subscriptions.get(topic)?.size === 0) {
      this.#subscriptions.delete(topic);
    }

    return true;
  }

  /**
   * Remove every subscription held by a given client.
   *
   * This class groups subscriptions by `clientId` as an indexing key — it does
   * not own "client" as an entity (that's `ClientRegistry`). So the operation
   * is framed as the bulk counterpart of `unsubscribe(clientId, topic)`:
   * "unsubscribe the client from everything".
   *
   * Efficiently walks the client → topics index.
   * Time complexity: O(n) where n = number of client's subscriptions.
   *
   * @param clientId - Unique client identifier (group key in this context)
   * @returns Topics from which the client was unsubscribed, in iteration
   *          order. Empty array when the client had no active subscriptions.
   *          Callers use this to emit granular `subscription.removed` events
   *          without a pre-read of the state.
   */
  unsubscribeAll(clientId: ClientID): readonly T[] {
    const clientTopics = this.#clientSubscriptions.get(clientId);
    if (!clientTopics || clientTopics.size === 0) {
      this.#clientSubscriptions.delete(clientId);
      return [];
    }

    const removed: T[] = [];
    for (const topic of clientTopics) {
      this.#subscriptions.get(topic)?.delete(clientId);

      if (this.#subscriptions.get(topic)?.size === 0) {
        this.#subscriptions.delete(topic);
      }

      const handlerKey = this.#getHandlerKey(clientId, topic);
      this.#handlers.delete(handlerKey);
      this.#handlerOptions.delete(handlerKey);

      removed.push(topic);
    }

    this.#clientSubscriptions.delete(clientId);
    return removed;
  }

  // ========================================
  // QUERY OPERATIONS
  // ========================================

  /**
   * Get all topics a client is subscribed to
   *
   * Used by BrokerCore.resetClient() to iterate and clean up each subscription.
   *
   * @param clientId - Unique client identifier
   * @returns Set of topics or undefined if client has no subscriptions
   */
  getClientTopics(clientId: ClientID): ReadonlySet<T> | undefined {
    return this.#clientSubscriptions.get(clientId);
  }

  /**
   * Check if a client is subscribed to a topic
   *
   * @param clientId - Unique client identifier
   * @param topic - Topic to check
   * @returns True if subscribed, false otherwise
   */
  isSubscribed(clientId: ClientID, topic: T): boolean {
    return this.#clientSubscriptions.get(clientId)?.has(topic) ?? false;
  }

  /**
   * Get the handler for a specific client and topic
   *
   * @param clientId - Unique client identifier
   * @param topic - Topic
   * @returns Handler function or undefined if not found
   */
  getHandler(clientId: ClientID, topic: T): MessageHandler | undefined {
    const handlerKey = this.#getHandlerKey(clientId, topic);
    return this.#handlers.get(handlerKey);
  }

  /**
   * Get backpressure options for a specific client and topic
   *
   * @param clientId - Unique client identifier
   * @param topic - Topic
   * @returns Backpressure options or undefined if not set
   */
  getOptions(clientId: ClientID, topic: T): SubscriptionOptions | undefined {
    const handlerKey = this.#getHandlerKey(clientId, topic);
    return this.#handlerOptions.get(handlerKey);
  }

  /**
   * Get all subscribers for a topic (read-only)
   *
   * @param topic - Topic
   * @returns Readonly set of client IDs
   */
  getSubscribers(topic: T): ReadonlySet<ClientID> {
    return this.#subscriptions.get(topic) ?? this.#emptySet;
  }

  /**
   * Get list of all clients that have active subscriptions
   *
   * @returns Array of client IDs
   */
  getAllSubscribedClients(): ClientID[] {
    return Array.from(this.#clientSubscriptions.keys());
  }

  /**
   * Get detailed subscription map for all clients
   *
   * Used by observability tools and DevTools for inspection.
   *
   * @returns Record mapping clientId to array of subscribed topics
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
   * Clear all subscriptions and handlers
   *
   * Called by BrokerCore.destroy() to clean up all resources.
   */
  clear(): void {
    this.#subscriptions.clear();
    this.#clientSubscriptions.clear();
    this.#handlers.clear();
    this.#handlerOptions.clear();
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Create composite key for handler storage
   * Format: "clientId:topic"
   * @private
   */
  #getHandlerKey(clientId: ClientID, topic: T): string {
    return `${clientId}:${topic}`;
  }
}
