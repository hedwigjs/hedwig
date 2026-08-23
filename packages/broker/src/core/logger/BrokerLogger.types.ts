/**
 * All structured log events emitted by the broker infrastructure.
 *
 * These are machine-readable codes — stable across versions.
 * Use them as filter keys in Sentry / Datadog / Grafana.
 */
export type BrokerLogEvent =
  // Broker lifecycle
  | 'broker.subscribe.after_destroy'
  | 'broker.bridge.add.after_destroy'
  | 'broker.bridge.replaced'
  | 'broker.client.register.after_destroy'
  | 'broker.replay.history_disabled'
  | 'facade.createClient.reset'
  // Message routing
  | 'handler.failed'
  // Hooks
  | 'hook.after_send.failed'
  | 'hook.failed'
  // Bridge
  | 'bridge.message.parse_failed'
  // Backpressure
  | 'backpressure.handler.failed'
  | 'backpressure.on_drop.failed'
  // Replay
  | 'replay.handler.failed'
  | 'replay.query.failed'
  // System events
  | 'system_events.listener.failed';

/**
 * Pluggable logger interface for broker infrastructure events.
 *
 * Implement this to redirect broker warnings and errors to your
 * observability stack (Sentry, Datadog, pino, etc.).
 *
 * @example
 * initBroker({
 *   logger: {
 *     warn: (event, meta) => myLogger.warn(event, meta),
 *     error: (event, meta) => Sentry.captureMessage(event, { extra: meta }),
 *   }
 * });
 */
export interface BrokerLogger {
  warn(event: BrokerLogEvent, meta?: Record<string, unknown>): void;
  error(event: BrokerLogEvent, meta?: Record<string, unknown>): void;
}

/**
 * Default logger — forwards to console.
 * Used when no logger is provided in BrokerConfig.
 */
export const defaultLogger: BrokerLogger = {
  warn(event, meta) {
    meta !== undefined
      ? console.warn(`[broker] ${event}`, meta)
      : console.warn(`[broker] ${event}`);
  },
  error(event, meta) {
    meta !== undefined
      ? console.error(`[broker] ${event}`, meta)
      : console.error(`[broker] ${event}`);
  },
};
