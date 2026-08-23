import type { BridgeConfig } from './bridge/Bridge.types';
import type { SystemEventsEmitter } from './events/SystemEvents.types';
import type { Inspector } from './observability/inspect/Inspector';
import type {
  OnSubscribeHook,
  BeforeSendHook,
  AfterSendHook,
} from './hooks/HooksRegistry.types';

/**
 * MessageBroker — the public contract of the broker instance.
 *
 * This is the type returned by `initBroker()` / `getBroker()`. It exposes
 * the stable, user-facing surface of the broker and intentionally HIDES
 * low-level internals (message pipeline, subscription management, client
 * registry plumbing) which are accessed via the {@link Client} instances
 * returned by `createClient()`.
 *
 * The broker surface is organized in three groups:
 *
 * 1. **Tooling APIs** — stable channels for DevTools / observers.
 *    - `$systemEvents` (push) for lifecycle events.
 *    - `inspect` (pull) for point-in-time state snapshots.
 *
 * 2. **Extensibility** — hooks that let adapters and plugins alter or
 *    observe broker behaviour without reaching into internals.
 *    - `useBeforeSendHook`, `useAfterSendHook`, `useOnSubscribeHook`.
 *
 * 3. **Infrastructure wiring** — bridges for cross-context delivery.
 *    - `addBridge(id, { transport, forward })`. Pass a {@link BridgeTransport}
 *      instance; built-in implementations are used internally by framework
 *      adapters and are not part of the public surface.
 *
 * 4. **Lifecycle**
 *    - `destroy()` for clean shutdown.
 */
export interface MessageBroker<T extends string, P extends Record<T, any>> {
  /**
   * Broker-internal system event channel (push model).
   *
   * The `$` prefix marks this as a broker-internal API. Intended for
   * tooling: DevTools, tracing collectors, metrics integrations.
   *
   * Not for extending broker behaviour — use the `use*Hook` methods
   * for that.
   *
   * @example
   * broker.$systemEvents.on('client.registered', ({ clientId }) => { ... });
   * broker.$systemEvents.on('subscription.added', ({ clientId, topic }) => { ... });
   */
  readonly $systemEvents: SystemEventsEmitter<T, P>;

  /**
   * Point-in-time state snapshots (pull model).
   *
   * Read-only view over broker state for DevTools and debugging tools.
   *
   * @example
   * const clients = broker.inspect.getClients();
   * const history = broker.inspect.getHistory();
   */
  readonly inspect: Inspector<T, P>;

  /**
   * Register a bridge for cross-context communication (idempotent).
   *
   * A bridge forwards messages whose topic matches `forward` patterns to
   * the given {@link BridgeTransport}, and injects messages coming back from
   * the transport into this broker. Framework adapters supply the transport;
   * this package does not export concrete transport classes.
   *
   * If a bridge with the given `id` already exists, the old one is
   * destroyed and replaced. This keeps the operation HMR-safe.
   *
   * @param id - Unique bridge identifier (e.g. `'cross-tab'`, `'iframe-checkout'`).
   * @param config - Bridge configuration: `transport` + `forward` patterns.
   * @returns Function that removes the bridge and tears down its listeners.
   */
  addBridge(id: string, config: BridgeConfig): () => void;

  /**
   * Register a `beforeSend` hook.
   *
   * Invoked synchronously before every message enters the routing stage,
   * for both locally-emitted AND externally-injected (bridge) messages.
   * Use `message.fromExternal` to distinguish.
   *
   * A hook returning `{ allowed: false, message }` short-circuits the
   * pipeline with a `NACK(HOOK_REJECTED)`.
   */
  useBeforeSendHook(hook: BeforeSendHook<T, P>): () => void;

  /**
   * Register an `afterSend` hook.
   *
   * Invoked after routing completes, regardless of success. Receives the
   * frozen message and the final {@link RoutingResult}. Runs for both
   * local and external messages.
   */
  useAfterSendHook(hook: AfterSendHook<T, P>): () => void;

  /**
   * Register an `onSubscribe` hook.
   *
   * Invoked synchronously when a client subscribes to a topic. A hook
   * returning `{ allowed: false, message }` prevents the subscription —
   * `BrokerClient.on()` will throw with `message`.
   */
  useOnSubscribeHook(hook: OnSubscribeHook<T>): () => void;

  /**
   * Shut the broker down and release all resources.
   *
   * Destroys every bridge, clears subscriptions, history, hooks and the
   * client registry. After `destroy()` the broker becomes inert: further
   * calls are no-ops with console warnings.
   */
  destroy(): void;
}
