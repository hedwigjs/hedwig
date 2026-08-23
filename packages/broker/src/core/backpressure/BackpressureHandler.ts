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
 * - Track active strategies per client
 *
 * Available strategies:
 * - Throttle: Limit handler calls to once per period
 * - Debounce: Delay execution until silence
 * - Rate Limit: Drop messages exceeding rate limit
 *
 * Note: Only ONE strategy can be specified per subscription.
 * Specifying multiple strategies will throw an error.
 */
export class BackpressureHandler {
  #strategies = new Map<string, BackpressureStrategy>();
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
   * @param clientId - Unique client identifier
   * @param topic - Topic being subscribed to
   * @param handler - Original handler function
   * @param options - Subscription options (optional)
   * @returns Wrapped handler or original handler if no backpressure options
   */
  wrap(
    clientId: ClientID,
    topic: string,
    handler: MessageHandler,
    options?: SubscriptionOptions,
  ): MessageHandler {
    // Extract backpressure options
    const bpOptions = options?.backpressure;

    // No backpressure options → return original handler
    if (!bpOptions) {
      return handler;
    }

    // Create strategy based on backpressure options
    const strategy = this.#createStrategy(bpOptions);
    const key = this.#getKey(clientId, topic);
    this.#strategies.set(key, strategy);

    // Return wrapped handler
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
   * Remove strategy for client/topic
   *
   * Called when client unsubscribes.
   * Flushes pending messages and cleans up resources.
   *
   * @param clientId - Client identifier
   * @param topic - Topic
   */
  remove(clientId: ClientID, topic: string): void {
    const key = this.#getKey(clientId, topic);
    const strategy = this.#strategies.get(key);

    if (strategy) {
      // Flush pending messages (ensure nothing is lost)
      strategy.flush();

      // Cleanup resources
      strategy.destroy();

      // Remove from map
      this.#strategies.delete(key);
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

  /**
   * Create unique key for client/topic pair
   */
  #getKey(clientId: ClientID, topic: string): string {
    return `${clientId}:${topic}`;
  }
}
