import type { Message, MessageHandler } from '../../types';
import type { BrokerLogger } from '../../logger/BrokerLogger.types';

/**
 * Invoke a subscriber handler from inside a backpressure strategy with full
 * error isolation: a synchronous throw is caught, and an async rejection is
 * caught too instead of surfacing as an unhandled promise rejection.
 *
 * The strategy never awaits the handler — strategies own timers, not
 * results — so the returned promise is only observed for its failure.
 */
export function invokeIsolated(
  handler: MessageHandler,
  message: Message,
  logger: BrokerLogger,
  strategy: 'throttle' | 'debounce' | 'rateLimit',
): void {
  const meta = {
    strategy,
    messageId: message.id,
    topic: message.topic,
    source: message.source,
  };
  try {
    const result = handler(message);
    if (
      result !== null &&
      typeof result === 'object' &&
      typeof (result as Promise<unknown>).then === 'function'
    ) {
      (result as Promise<unknown>).then(undefined, (error: unknown) => {
        logger.error('backpressure.handler.failed', { ...meta, error });
      });
    }
  } catch (error) {
    logger.error('backpressure.handler.failed', { ...meta, error });
  }
}
