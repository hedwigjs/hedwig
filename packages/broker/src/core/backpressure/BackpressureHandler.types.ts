import type { Message, MessageHandler } from '../types';

export type { BackpressureOptions } from '@hedwigjs/client';

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
