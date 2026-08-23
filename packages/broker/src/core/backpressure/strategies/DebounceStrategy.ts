import type { Message, MessageHandler } from '../../types';
import type { BackpressureStrategy } from '../BackpressureHandler.types';
import type { BrokerLogger } from '../../logger/BrokerLogger.types';

/**
 * DebounceStrategy - Delays handler execution until silence period
 *
 * Algorithm:
 * 1. On each message, reset the timer
 * 2. Save the last message
 * 3. Execute only after debounce period of silence
 *
 * Guarantees:
 * - Handler called only after user stops
 * - Only last message is processed
 * - Earlier messages are ignored (not lost, just not needed)
 *
 * Use cases:
 * - Search autocomplete (wait for user to stop typing)
 * - Form validation (validate after pause in input)
 * - Window resize handlers
 */
export class DebounceStrategy implements BackpressureStrategy {
  #debounceMs: number;
  #timeoutId?: NodeJS.Timeout;
  #pendingMessage?: Message;
  #pendingHandler?: MessageHandler;
  #logger: BrokerLogger;

  constructor(debounceMs: number, logger: BrokerLogger) {
    if (typeof debounceMs !== 'number' || !Number.isFinite(debounceMs)) {
      throw new Error('Debounce period must be a finite number');
    }
    if (debounceMs <= 0) {
      throw new Error('Debounce period must be positive');
    }
    this.#debounceMs = debounceMs;
    this.#logger = logger;
  }

  /**
   * Process message through debounce
   *
   * Resets timer on each call. Only executes after silence period.
   *
   * @param message - Incoming message
   * @param handler - Handler to call
   * @returns false (always delayed)
   */
  process(message: Message, handler: MessageHandler): boolean {
    // Clear previous timer
    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId);
    }

    // Save message and handler
    this.#pendingMessage = message;
    this.#pendingHandler = handler;

    // Start new timer
    this.#timeoutId = setTimeout(() => {
      this.#flush();
    }, this.#debounceMs);

    return false; // Always delayed
  }

  /**
   * Execute pending message
   */
  #flush(): void {
    if (this.#pendingMessage && this.#pendingHandler) {
      try {
        this.#pendingHandler(this.#pendingMessage);
      } catch (error) {
        this.#logger.error('backpressure.handler.failed', { strategy: 'debounce', error });
      }
    }

    // Clear state
    this.#pendingMessage = undefined;
    this.#pendingHandler = undefined;
    this.#timeoutId = undefined;
  }

  /**
   * Force flush pending message
   * Called on unsubscribe to ensure no messages are lost
   */
  flush(): void {
    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId);
      this.#flush();
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId);
    }
    this.#pendingMessage = undefined;
    this.#pendingHandler = undefined;
  }
}
