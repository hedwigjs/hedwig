import type { BrokerLogger, BrokerLogEvent } from './BrokerLogger.types';

/**
 * Wrap a user-supplied {@link BrokerLogger} so that a throwing logger can
 * never take the broker pipeline down with it.
 *
 * Every internal `logger.warn` / `logger.error` call sits inside a `catch`
 * block or on a hot path. If the logger itself throws (network sink is down,
 * a serializer choked on the meta object, …) the exception would otherwise
 * escape into `emit()` / `request()` and reject the caller's promise — a
 * broken observability sink turning into a broken message bus.
 *
 * The wrapper catches the logger's exception and reports it straight to
 * `console.error`. It deliberately does NOT route the failure through the
 * wrapped logger again — that would recurse into the same broken sink.
 */
export function createSafeLogger(logger: BrokerLogger): BrokerLogger {
  return {
    warn(event: BrokerLogEvent, meta?: Record<string, unknown>): void {
      try {
        logger.warn(event, meta);
      } catch (error) {
        reportLoggerFailure('warn', event, meta, error);
      }
    },
    error(event: BrokerLogEvent, meta?: Record<string, unknown>): void {
      try {
        logger.error(event, meta);
      } catch (error) {
        reportLoggerFailure('error', event, meta, error);
      }
    },
  };
}

function reportLoggerFailure(
  level: 'warn' | 'error',
  event: BrokerLogEvent,
  meta: Record<string, unknown> | undefined,
  error: unknown,
): void {
  try {
    console.error('[broker] logger.failed', { level, event, meta, error });
  } catch {
    // Even console can be monkey-patched into throwing. Nothing left to do —
    // swallowing here is the only way to keep the pipeline alive.
  }
}
