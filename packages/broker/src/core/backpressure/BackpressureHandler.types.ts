import type { Message, MessageHandler } from '../types';

/**
 * Backpressure strategies to control message processing rate
 *
 * Control how messages are processed to prevent UI freezing and optimize performance.
 * All strategies are mutually exclusive - only one can be used per subscription.
 */
export interface BackpressureOptions {
  /**
   * Throttle: Limit handler calls to once per `throttle` milliseconds
   *
   * First call executes immediately, subsequent calls are delayed.
   * Guarantees maximum call rate without losing the last message.
   *
   * Use case: Real-time charts, high-frequency updates
   */
  throttle?: number;

  /**
   * Debounce: Delay handler execution until `debounce` milliseconds of silence
   *
   * Resets timer on each new message. Only the last message is processed.
   *
   * Use case: Search autocomplete, input validation
   */
  debounce?: number;

  /**
   * Rate limiting: Drop messages exceeding rate limit
   *
   * Allows maximum `max` messages per `window` milliseconds.
   * Messages exceeding the limit are dropped (lost permanently).
   *
   * Use case: Prevent flooding, protect from bursts, spam protection
   */
  rateLimit?: {
    /** Maximum number of messages allowed */
    max: number;
    /** Time window in milliseconds */
    window: number;
  };

  /**
   * Callback when messages are dropped (rate limiting only)
   *
   * @param droppedCount - Number of messages dropped so far
   */
  onDrop?: (droppedCount: number) => void;
}

/**
 * Base interface for backpressure strategies
 *
 * Each strategy implements a specific backpressure algorithm:
 * - ThrottleStrategy: Rate limiting with guaranteed last message
 * - DebounceStrategy: Delay until silence
 * - RateLimitStrategy: Hard limit with message dropping
 */
export interface BackpressureStrategy {
  /**
   * Process incoming message through strategy
   *
   * @param message - Incoming message
   * @param handler - Original handler function
   * @returns true if message was processed immediately, false if delayed/dropped
   */
  process(message: Message, handler: MessageHandler): boolean;

  /**
   * Force flush pending messages
   *
   * Called on unsubscribe to ensure no messages are lost.
   */
  flush(): void;

  /**
   * Cleanup resources (timers, pending messages, etc.)
   *
   * Called when strategy is no longer needed.
   */
  destroy(): void;
}

/**
 * Backpressure metrics for observability
 *
 * Track backpressure behavior for monitoring and debugging.
 */
export interface BackpressureMetrics {
  /** Number of messages throttled (delayed) */
  throttled: number;
  /** Number of messages debounced (ignored while waiting) */
  debounced: number;
  /** Number of messages dropped (rate limit) */
  dropped: number;
  /** Number of active timers */
  activeTimers: number;
}
