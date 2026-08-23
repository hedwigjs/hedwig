import type { Message, MessageHandler } from '../../types';
import type { BackpressureStrategy } from '../BackpressureHandler.types';
import type { BrokerLogger } from '../../logger/BrokerLogger.types';

/**
 * RateLimitStrategy - Limits message processing rate with hard cap
 *
 * Algorithm (Sliding Window with Circular Buffer):
 * 1. Pre-allocate a fixed-size buffer of `max` timestamps
 * 2. On new message:
 *    - Evict expired timestamps by advancing head pointer
 *    - If count < max: record timestamp and allow message
 *    - If count >= max: drop message + call onDrop()
 *
 * Key difference from throttle:
 * - Messages are DROPPED (lost forever), not delayed
 * - Hard limit enforcement
 * - No guarantees about which messages are kept
 *
 * Use cases:
 * - Spam protection
 * - Flood prevention
 * - Offline recovery (limit burst)
 * - API rate limiting
 */
export class RateLimitStrategy implements BackpressureStrategy {
  #max: number;
  #windowMs: number;
  #onDrop?: (droppedCount: number) => void;
  #timestamps: number[];
  #head = 0;
  #count = 0;
  #droppedCount = 0;

  #logger: BrokerLogger;

  constructor(options: { max: number; window: number }, onDrop: ((droppedCount: number) => void) | undefined, logger: BrokerLogger) {
    if (typeof options.max !== 'number' || !Number.isFinite(options.max)) {
      throw new Error('Rate limit max must be a finite number');
    }
    if (options.max <= 0) {
      throw new Error('Rate limit max must be positive');
    }

    if (typeof options.window !== 'number' || !Number.isFinite(options.window)) {
      throw new Error('Rate limit window must be a finite number');
    }
    if (options.window <= 0) {
      throw new Error('Rate limit window must be positive');
    }

    this.#max = options.max;
    this.#windowMs = options.window;
    this.#onDrop = onDrop;
    this.#timestamps = new Array(options.max).fill(0);
    this.#logger = logger;
  }

  /**
   * Process message through rate limit
   *
   * Uses sliding window with circular buffer for O(1) amortized eviction.
   *
   * @param message - Incoming message
   * @param handler - Handler to call
   * @returns true if processed, false if dropped
   */
  process(message: Message, handler: MessageHandler): boolean {
    const now = Date.now();

    this.#evict(now);

    if (this.#count < this.#max) {
      const tail = (this.#head + this.#count) % this.#max;
      this.#timestamps[tail] = now;
      this.#count++;

      try {
        handler(message);
      } catch (error) {
        this.#logger.error('backpressure.handler.failed', { strategy: 'rateLimit', error });
      }

      return true;
    }

    this.#droppedCount++;

    if (this.#onDrop) {
      try {
        this.#onDrop(this.#droppedCount);
      } catch (error) {
        this.#logger.error('backpressure.on_drop.failed', { error });
      }
    }

    return false;
  }

  /**
   * Flush is no-op for rate limiting
   * Rate limit doesn't accumulate messages, so nothing to flush
   */
  flush(): void {
    // No-op: rate limit doesn't buffer messages
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.#head = 0;
    this.#count = 0;
    this.#timestamps.fill(0);
  }

  /**
   * Get number of dropped messages (for debugging/metrics)
   */
  get droppedCount(): number {
    return this.#droppedCount;
  }

  /**
   * Get current count in window (for debugging/metrics)
   */
  get currentCount(): number {
    this.#evict(Date.now());
    return this.#count;
  }

  /** Advance head past expired timestamps */
  #evict(now: number): void {
    while (this.#count > 0 && now - this.#timestamps[this.#head] >= this.#windowMs) {
      this.#head = (this.#head + 1) % this.#max;
      this.#count--;
    }
  }
}
