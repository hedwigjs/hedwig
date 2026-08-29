import type { ClientID, SubscriptionOptions } from '../types';

/**
 * System events - internal signals about broker state transitions.
 *
 * These are NOT user messages. System events expose infrastructure-level
 * state changes (client/subscription/bridge lifecycle) that are not
 * observable through the hook pipeline.
 *
 * Intended consumers:
 * - DevTools (message-broker-devtools)
 * - Tracing / metrics integrations
 *
 * These events are FIRE-AND-FORGET. Listeners cannot influence the pipeline;
 * exceptions thrown from a listener are caught and logged, not propagated.
 *
 * Exposed on the broker under `$systemEvents` (the `$` prefix signals that
 * this is a broker-internal channel, distinct from user message pub/sub).
 */
export interface SystemEventMap<T extends string, P extends Record<T, any>> {
  // ─── Clients ──────────────────────────────────────────────────────────────

  'client.registered': {
    clientId: ClientID;
    /** Unix ms when the client was registered. */
    at: number;
  };
  'client.unregistered': {
    clientId: ClientID;
    /** Unix ms when the client was unregistered. */
    at: number;
  };

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  'subscription.added': {
    clientId: ClientID;
    topic: T;
    options?: SubscriptionOptions;
  };
  'subscription.removed': {
    clientId: ClientID;
    topic: T;
  };
  /**
   * Fired when an `onSubscribe` hook denied a subscription attempt. The
   * broker still throws on the caller so the subscription is NOT registered;
   * this event exists so observability tools (DevTools, ACL audit) can pick
   * up the denial without racing the exception.
   */
  'subscription.rejected': {
    clientId: ClientID;
    topic: T;
    reason: string;
  };

  // ─── Send rejections (hook-driven) ────────────────────────────────────────

  /**
   * Fired when a `beforeSend` hook denied an outgoing message. The message
   * also surfaces in the delivery result as `NACK HOOK_REJECTED`, but this
   * event lets pure-observability consumers listen for security signals on a
   * dedicated channel without inspecting every RoutingResult.
   */
  'message.rejected': {
    source: ClientID;
    target: ClientID | '*';
    topic: T;
    reason: string;
  };

  // ─── Bridges (lifecycle only — message flow is visible via afterSend) ──────

  'bridge.added': { bridgeId: string };
  'bridge.removed': { bridgeId: string };
}

export type SystemEventName<T extends string, P extends Record<T, any>> = keyof SystemEventMap<
  T,
  P
>;

export type SystemEventPayload<
  T extends string,
  P extends Record<T, any>,
  K extends SystemEventName<T, P>,
> = SystemEventMap<T, P>[K];

/**
 * Listener for a specific system event. Receives the event payload.
 * Exceptions are caught by the dispatcher.
 */
export type SystemEventListener<
  T extends string,
  P extends Record<T, any>,
  K extends SystemEventName<T, P>,
> = (payload: SystemEventPayload<T, P, K>) => void;

/**
 * Listener that receives every system event with its name.
 * Useful for universal recorders (e.g. DevTools event log).
 */
export type SystemAnyEventListener<T extends string, P extends Record<T, any>> = <
  K extends SystemEventName<T, P>,
>(
  event: K,
  payload: SystemEventPayload<T, P, K>,
) => void;

/**
 * Subscriber contract for the system event channel.
 *
 * Consumers (DevTools, tracing, metrics) use this to subscribe. Listeners
 * are fire-and-forget — they cannot influence the pipeline, and exceptions
 * they throw are caught and logged, never propagated.
 *
 * `emit()` and `clear()` are intentionally absent: only `BrokerCore`
 * (which holds the concrete `SystemEvents` instance) can publish events
 * or tear down listeners.
 */
export interface SystemEventsEmitter<T extends string, P extends Record<T, any>> {
  /**
   * Subscribe to a specific system event.
   * @returns Unsubscribe function.
   */
  on<K extends SystemEventName<T, P>>(
    event: K,
    listener: SystemEventListener<T, P, K>,
  ): () => void;

  /**
   * Subscribe once — listener is automatically removed after first invocation.
   * @returns Unsubscribe function.
   */
  once<K extends SystemEventName<T, P>>(
    event: K,
    listener: SystemEventListener<T, P, K>,
  ): () => void;

  /**
   * Remove all listeners for a given event. Omit `event` to clear everything.
   */
  off<K extends SystemEventName<T, P>>(event?: K): void;

  /**
   * Subscribe to every system event with one listener.
   * Useful for DevTools panels that need a unified event feed.
   * @returns Unsubscribe function.
   */
  onAny(listener: SystemAnyEventListener<T, P>): () => void;

  /**
   * Number of registered listeners for a given event, or total across all
   * events when called without arguments. Useful for tests and fast-path checks.
   */
  listenerCount<K extends SystemEventName<T, P>>(event?: K): number;
}
