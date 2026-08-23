import type { ClientID, SubscriptionOptions } from '../types';

/**
 * Broker system events.
 *
 * Observability events expose infrastructure-level state changes that are
 * NOT observable through the business hook pipeline (beforeSend / afterSend /
 * onSubscribe). Every event here gives information that can't be derived
 * from hooks alone.
 *
 * Intended consumers:
 * - DevTools (message-broker-devtools)
 * - Tracing / metrics integrations
 *
 * These events are FIRE-AND-FORGET. Listeners cannot influence the pipeline;
 * exceptions thrown from a listener are caught and logged, not propagated.
 */
export interface BrokerEventMap<T extends string, P extends Record<T, any>> {
  // ─── Clients (granular replacement for the old useClientChangeHook) ────────

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

  // ─── Bridges (lifecycle only — message flow is visible via afterSend) ──────

  'bridge.added': { bridgeId: string };
  'bridge.removed': { bridgeId: string };

  // ─── Backpressure ──────────────────────────────────────────────────────────

  'backpressure.dropped': {
    clientId: ClientID;
    topic: T;
    strategy: 'rateLimit';
    droppedCount: number;
  };
}

export type BrokerEventName<T extends string, P extends Record<T, any>> = keyof BrokerEventMap<
  T,
  P
>;

export type BrokerEventPayload<
  T extends string,
  P extends Record<T, any>,
  K extends BrokerEventName<T, P>,
> = BrokerEventMap<T, P>[K];

/**
 * Listener for a specific event. Receives the event payload.
 * Exceptions are caught by the dispatcher.
 */
export type BrokerEventListener<
  T extends string,
  P extends Record<T, any>,
  K extends BrokerEventName<T, P>,
> = (payload: BrokerEventPayload<T, P, K>) => void;

/**
 * Listener that receives every event with its name.
 * Useful for universal recorders (e.g. DevTools event log).
 */
export type BrokerAnyEventListener<T extends string, P extends Record<T, any>> = <
  K extends BrokerEventName<T, P>,
>(
  event: K,
  payload: BrokerEventPayload<T, P, K>,
) => void;
