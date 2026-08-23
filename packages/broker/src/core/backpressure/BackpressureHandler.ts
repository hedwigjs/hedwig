import type { ClientID, MessageHandler, SubscriptionOptions } from '../types';
import type { BackpressureStrategy, BackpressureOptions } from './BackpressureHandler.types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';
import { ThrottleStrategy } from './strategies/ThrottleStrategy';
import { DebounceStrategy } from './strategies/DebounceStrategy';
import { RateLimitStrategy } from './strategies/RateLimitStrategy';

/**
 * BackpressureHandler - Coordinates backpressure strategies
 *
 * Responsibilities:
 * - Create appropriate strategy based on options
 * - Wrap handlers with strategy logic
 * - Manage strategy lifecycle (cleanup on unsubscribe)
 *
 * Available strategies:
 * - Throttle: Limit handler calls to once per period
 * - Debounce: Delay execution until silence
 * - Rate Limit: Drop messages exceeding rate limit
 *
 * Multi-handler model: each subscription on a `(clientId, topic)` pair
 * gets its own strategy instance, keyed by the subscription id.
 *
 * Note: Only ONE strategy can be specified per subscription. Specifying
 * multiple strategies will throw an error.
 */
export class BackpressureHandler {
  /** subscriptionId → strategy. One entry per handler that opted into BP. */
  #strategies = new Map<number, BackpressureStrategy>();
  #logger: BrokerLogger;

  constructor(logger: BrokerLogger) {
    this.#logger = logger;
  }

  /**
   * Wrap handler in backpressure strategy
   *
   * If options.backpressure is undefined/null, returns original handler (no backpressure).
   * Otherwise creates appropriate strategy and returns wrapped handler.
   *
   * @param subscriptionId - Unique id of this handler subscription.
   *   The id is emitted by {@link Subscriptions.subscribe} — the caller is
   *   responsible for reserving it and passing the same value to both
   *   `wrap()` and `subscribe()` so the strategy can be released via
   *   {@link removeOne} when that specific handler unsubscribes.
   * @param clientId - Unique client identifier (for logging context)
   * @param topic - Topic being subscribed to (for logging context)
   * @param handler - Original handler function
   * @param options - Subscription options (optional)
   * @returns Wrapped handler or original handler if no backpressure options
   */
  wrap(
    subscriptionId: number,
    clientId: ClientID,
    topic: string,
    handler: MessageHandler,
    options?: SubscriptionOptions,
  ): MessageHandler {
    void clientId;
    void topic;

    const bpOptions = options?.backpressure;
    if (!bpOptions) {
      return handler;
    }

    const strategy = this.#createStrategy(bpOptions);
    this.#strategies.set(subscriptionId, strategy);

    return (message) => {
      strategy.process(message, handler);
    };
  }

  /**
   * Create strategy instance based on backpressure options
   *
   * Only ONE strategy can be specified per subscription.
   * Multiple strategies will throw an error.
   *
   * @throws Error if no strategy specified
   * @throws Error if multiple strategies specified
   */
  #createStrategy(options: BackpressureOptions): BackpressureStrategy {
    // Validate: only one strategy allowed
    const specifiedStrategies = [
      options.throttle !== undefined && 'throttle',
      options.debounce !== undefined && 'debounce',
      options.rateLimit !== undefined && 'rateLimit',
    ].filter(Boolean) as string[];

    if (specifiedStrategies.length === 0) {
      throw new Error(
        'No backpressure strategy specified. ' +
          'Provide one of: throttle, debounce, or rateLimit.',
      );
    }

    if (specifiedStrategies.length > 1) {
      throw new Error(
        `Multiple backpressure strategies specified: ${specifiedStrategies.join(', ')}. ` +
          'Only one strategy is allowed per subscription.',
      );
    }

    // Create strategy (only one will match)
    if (options.throttle !== undefined) {
      return new ThrottleStrategy(options.throttle, this.#logger);
    }

    if (options.debounce !== undefined) {
      return new DebounceStrategy(options.debounce, this.#logger);
    }

    if (options.rateLimit) {
      return new RateLimitStrategy(options.rateLimit, options.onDrop, this.#logger);
    }

    // Unreachable (covered by validation above)
    throw new Error('No backpressure strategy specified in BackpressureOptions');
  }

  /**
   * Release the strategy attached to a single subscription id.
   *
   * Called when the corresponding handler unsubscribes. Flushes pending
   * messages and destroys the strategy. No-op when the subscription had
   * no backpressure.
   */
  removeOne(subscriptionId: number): void {
    const strategy = this.#strategies.get(subscriptionId);
    if (!strategy) return;
    strategy.flush();
    strategy.destroy();
    this.#strategies.delete(subscriptionId);
  }

  /**
   * Bulk release for a set of subscription ids.
   *
   * Used when a client unsubscribes from a whole topic (or resets), which
   * removes N handlers at once.
   */
  removeMany(subscriptionIds: Iterable<number>): void {
    for (const id of subscriptionIds) {
      this.removeOne(id);
    }
  }

  /**
   * Cleanup all strategies
   *
   * Called when broker is destroyed.
   */
  destroy(): void {
    for (const strategy of this.#strategies.values()) {
      strategy.flush();
      strategy.destroy();
    }
    this.#strategies.clear();
  }

  /**
   * Get number of active strategies (for debugging/metrics)
   */
  get activeStrategies(): number {
    return this.#strategies.size;
  }
}
