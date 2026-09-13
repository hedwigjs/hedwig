import type { ClientID, SubscriptionOptions } from '../types';

/**
 * System events - internal signals about broker state transitions.
 *
 * These are NOT user messages. System events expose infrastructure-level
 * state changes (client/subscription/remote-client lifecycle) that are not
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
  // ─── Realm singleton ──────────────────────────────────────────────────────

  /**
   * Another (compatible) copy of `@hedwigjs/broker` on this page adopted
   * the existing instance through the realm registry (Module Federation
   * without `singleton: true`, two bundlers, ESM + CJS duplicates).
   * Everything still talks on one bus; the event exists so the duplication
   * is visible instead of silent. `copies` counts adoptions so far. An
   * INCOMPATIBLE copy never adopts — it throws at `initBroker` /
   * `getBroker` / `createClient` instead.
   */
  'broker.duplicate_copy': {
    version: string;
    copyVersion: string;
    copies: number;
    at: number;
  };

  // ─── Clients ──────────────────────────────────────────────────────────────

  'client.registered': {
    clientId: ClientID;
    /** Unix ms when the client was registered. */
    at: number;
    /** Version of `@hedwigjs/client` behind the call; absent for host-created clients and remotes. */
    sdkVersion?: string;
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

  // ─── Hooks ────────────────────────────────────────────────────────────────

  /**
   * A hook threw. For guard hooks (`beforeSend`, `onSubscribe`) `failMode`
   * says what the broker did: `'closed'` treated it as a denial,
   * `'open'` skipped it. Observer hooks (`afterSend`) are always skipped.
   */
  'hook.failed': {
    kind: 'beforeSend' | 'onSubscribe' | 'afterSend';
    failMode: 'open' | 'closed';
    error: unknown;
    topic?: T;
    messageId?: string;
    source?: ClientID;
    clientId?: ClientID;
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

  // ─── Remote clients ───────────────────────────────────────────────────────

  'remote.created': {
    remoteId: string;
    kind: string;
    identity: 'fixed' | 'allow' | 'prefix';
    at: number;
  };
  'remote.destroyed': { remoteId: string; at: number };
  /**
   * An inbound frame was dropped at the remote client before any hook:
   * too large, rate-limited, malformed, unsupported `v` / `kind`, an echo
   * of this realm's own frame, topic not in `accepts`, or a `source` the
   * identity mode rejects. `source` / `topic` are what the frame claimed.
   */
  'remote.frame.rejected': {
    remoteId: string;
    reason:
      | 'MALFORMED'
      | 'TOO_LARGE'
      | 'RATE_LIMITED'
      | 'TOPIC_NOT_ACCEPTED'
      | 'SOURCE_MISMATCH'
      | 'SOURCE_NOT_ALLOWED'
      | 'UNSUPPORTED'
      | 'ECHO';
    source?: string;
    topic?: string;
  };
  /**
   * A frame for the remote could not be sent: the transport threw
   * (`TRANSPORT_THREW`) or never became ready (`NOT_OPEN`). Local delivery
   * already happened; this is the only trace.
   */
  'remote.send.failed': {
    remoteId: string;
    topic: T;
    messageId: string;
    reason: 'TRANSPORT_THREW' | 'NOT_OPEN';
    error?: unknown;
  };

  // ─── Requests over a wire (trace; the message row carries the result) ──

  /** A local `request()` to a remote client left as a `kind: 'request'` frame. */
  'request.forwarded': {
    remoteId: string;
    topic: T;
    messageId: string;
    correlationId: string;
    deadline?: number;
  };
  /** A `kind: 'response'` frame matched a pending request on that remote. */
  'response.received': {
    remoteId: string;
    topic: T;
    correlationId: string;
    status: 'ACK' | 'NACK';
    reason: string;
    latencyMs: number;
  };
  /** A pending request to a remote expired locally; the far side may still run it. */
  'request.timeout': {
    remoteId: string;
    topic: T;
    correlationId: string;
    timeout: number;
  };
  /** A request that arrived from a remote was answered over the same transport. */
  'response.sent': {
    remoteId: string;
    topic: T;
    correlationId: string;
    status: 'ACK' | 'NACK';
    reason: string;
  };
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
