import type {
  SystemEventsEmitter,
  SystemEventName,
  SystemEventPayload,
  SystemEventListener,
  SystemAnyEventListener,
} from './SystemEvents.types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';

/**
 * System events channel - pub/sub dispatcher for broker-internal events.
 *
 * Not to be confused with the user message bus (`broker.emit` / `client.on`).
 * This channel carries infrastructure-level signals (client/subscription/bridge
 * lifecycle) and is exposed on the broker as `$systemEvents`. The `$` prefix
 * marks it as a broker-internal API — consumers should be tooling only.
 *
 * Keeps per-event listener sets and an "any" listener set.
 * Emission is synchronous, error-isolated, and O(n) in the number of
 * listeners for the given event.
 *
 * `emit()` and `clear()` are only on this class (not on the `SystemEventsEmitter`
 * interface), so only code that holds the concrete instance — i.e. `BrokerCore` —
 * can publish events or tear down listeners.
 */
export class SystemEvents<T extends string, P extends Record<T, any>>
  implements SystemEventsEmitter<T, P>
{
  #listeners = new Map<SystemEventName<T, P>, Set<(payload: any) => void>>();
  #anyListeners = new Set<SystemAnyEventListener<T, P>>();
  #logger: BrokerLogger;

  constructor(logger: BrokerLogger) {
    this.#logger = logger;
  }

  on<K extends SystemEventName<T, P>>(
    event: K,
    listener: SystemEventListener<T, P, K>,
  ): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as (payload: any) => void);

    return () => {
      const s = this.#listeners.get(event);
      if (!s) return;
      s.delete(listener as (payload: any) => void);
      if (s.size === 0) this.#listeners.delete(event);
    };
  }

  once<K extends SystemEventName<T, P>>(
    event: K,
    listener: SystemEventListener<T, P, K>,
  ): () => void {
    const wrapped: SystemEventListener<T, P, K> = (payload) => {
      unsubscribe();
      listener(payload);
    };
    const unsubscribe = this.on(event, wrapped);
    return unsubscribe;
  }

  off<K extends SystemEventName<T, P>>(event?: K): void {
    if (event === undefined) {
      this.#listeners.clear();
      return;
    }
    this.#listeners.delete(event);
  }

  onAny(listener: SystemAnyEventListener<T, P>): () => void {
    this.#anyListeners.add(listener);
    return () => this.#anyListeners.delete(listener);
  }

  listenerCount<K extends SystemEventName<T, P>>(event?: K): number {
    if (event === undefined) {
      let total = this.#anyListeners.size;
      for (const set of this.#listeners.values()) total += set.size;
      return total;
    }
    return (this.#listeners.get(event)?.size ?? 0) + this.#anyListeners.size;
  }

  /**
   * Emit a system event to all subscribed listeners.
   *
   * Safe to call on the hot path: returns immediately when no listeners are
   * registered (zero allocation). Listener errors are caught and logged;
   * they never propagate back to the broker pipeline.
   */
  emit<K extends SystemEventName<T, P>>(event: K, payload: SystemEventPayload<T, P, K>): void {
    if (this.#anyListeners.size === 0) {
      const direct = this.#listeners.get(event);
      if (!direct || direct.size === 0) return;
      this.#dispatch(direct, payload, event);
      return;
    }

    const direct = this.#listeners.get(event);
    if (direct && direct.size > 0) this.#dispatch(direct, payload, event);

    for (const listener of this.#anyListeners) {
      try {
        listener(event, payload);
      } catch (err) {
        this.#logger.error('system_events.listener.failed', { event: String(event), error: err });
      }
    }
  }

  /**
   * Remove all listeners. Called by `BrokerCore.destroy()`.
   */
  clear(): void {
    this.#listeners.clear();
    this.#anyListeners.clear();
  }

  #dispatch<K extends SystemEventName<T, P>>(
    listeners: Set<(payload: any) => void>,
    payload: SystemEventPayload<T, P, K>,
    event: K,
  ): void {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        this.#logger.error('system_events.listener.failed', { event: String(event), error: err });
      }
    }
  }
}
