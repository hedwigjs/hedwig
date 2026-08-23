import type { Message, MessageHandler } from '../../types';
import type { BackpressureStrategy } from '../BackpressureHandler.types';
import type { BrokerLogger } from '../../logger/BrokerLogger.types';

/**
 * ThrottleStrategy - Limits handler calls to once per throttle period
 *
 * Algorithm:
 * 1. First call executes immediately
 * 2. Subsequent calls within throttle period are delayed
 * 3. Only the last pending message is executed after throttle period
 *
 * Guarantees:
 * - Maximum call rate (1 per throttleMs)
 * - Last message is always processed (not lost)
 *
 * Use cases:
 * - Real-time charts (limit chart updates)
 * - High-frequency WebSocket streams
 * - Scroll/resize message handlers
 */
export class ThrottleStrategy implements BackpressureStrategy {
  #throttleMs: number;
  #lastExecutionTime = 0;
  #timeoutId?: NodeJS.Timeout;
  #pendingMessage?: Message;
  #pendingHandler?: MessageHandler;
  #logger: BrokerLogger;

  constructor(throttleMs: number, logger: BrokerLogger) {
    if (typeof throttleMs !== 'number' || !Number.isFinite(throttleMs)) {
      throw new Error('Throttle period must be a finite number');
    }
    if (throttleMs <= 0) {
      throw new Error('Throttle period must be positive');
    }
    this.#throttleMs = throttleMs;
    this.#logger = logger;
  }

  /**
   * Process message through throttle
   *
   * @param message - Incoming message
   * @param handler - Handler to call
   * @returns true if executed immediately, false if delayed
   */
  process(message: Message, handler: MessageHandler): boolean {
    const now = Date.now();
    const timeSinceLastExecution = now - this.#lastExecutionTime;

    // Can execute immediately
    if (timeSinceLastExecution >= this.#throttleMs) {
      this.#execute(message, handler);
      return true;
    }

    // Delay execution - save message and handler
    this.#pendingMessage = message;
    this.#pendingHandler = handler;

    // Schedule execution if not already scheduled
    if (!this.#timeoutId) {
      const delay = this.#throttleMs - timeSinceLastExecution;
      this.#timeoutId = setTimeout(() => {
        this.#flush();
      }, delay);
    }

    return false; // Delayed
  }

  /**
   * Execute handler and update last execution time
   */
  #execute(message: Message, handler: MessageHandler): void {
    this.#lastExecutionTime = Date.now();
    try {
      handler(message);
    } catch (error) {
      this.#logger.error('backpressure.handler.failed', { strategy: 'throttle', error });
    }
  }

  /**
   * Flush pending message
   */
  #flush(): void {
    if (this.#pendingMessage && this.#pendingHandler) {
      this.#execute(this.#pendingMessage, this.#pendingHandler);
    }

    // Clear state
    this.#pendingMessage = undefined;
    this.#pendingHandler = undefined;
    this.#timeoutId = undefined;
  }

  /**
   * Force flush pending messages
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
