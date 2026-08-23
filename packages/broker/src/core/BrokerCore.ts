import { Bridge as BridgeImpl } from './bridge/Bridge';
import { RoutingResult, RoutingReason } from './routing/RoutingResult';
import { Router } from './routing/Router';
import { HooksRegistry } from './hooks/HooksRegistry';
import { ClientRegistry } from './client/ClientRegistry';
import { Subscriptions } from './routing/Subscriptions';
import { BackpressureHandler } from './backpressure/BackpressureHandler';
import { MessageHistory } from './history/MessageHistory';
import { SubscriptionReplay } from './history/SubscriptionReplay';
import { SystemEvents } from './events/SystemEvents';
import { Inspector } from './observability/inspect/Inspector';
import { deepFreeze } from './utils/deepFreeze';
import { defaultLogger } from './logger/BrokerLogger.types';

import type {
  Message,
  ClientID,
  MessageHandler,
  SubscriptionOptions,
  BrokerConfig,
  MessageOptions,
} from './types';
import type { BrokerLogger } from './logger/BrokerLogger.types';
import type { BrokerClient } from './client/BrokerClient';
import type { OnSubscribeHook, BeforeSendHook, AfterSendHook } from './hooks/HooksRegistry.types';
import type { Bridge, BridgeConfig, ExternalMessageInjector } from './bridge/Bridge.types';
import type { SystemEventsEmitter } from './events/SystemEvents.types';
import type { MessageBroker } from './MessageBroker';

/**
 * BrokerCore — low-level message broker engine, internal implementation
 * of the public {@link MessageBroker} interface.
 *
 * Responsibilities:
 * - Message routing and delivery pipeline (hooks → routing → history → bridges)
 * - Subscription management (delegates to Subscriptions)
 * - Coordinate Router, HooksRegistry, ClientRegistry
 * - Bridge management for cross-context communication
 * - Message history & replay
 * - Emit system events on the internal system events channel
 * - Expose state snapshots via the inspect facade
 * - Lifecycle management
 *
 * The class is exported within the package for unit tests. Consumers
 * receive only the `MessageBroker<T, P>` contract from `initBroker()` /
 * `getBroker()`. Methods tagged `@internal` (subscribe, unsubscribe,
 * processMessage, registerClient, unregisterClient, resetClient,
 * getClient) form the internal protocol between
 * BrokerClient, Bridge and the facade — they are stable only inside the
 * package and may change without notice.
 */
export class BrokerCore<T extends string, P extends Record<T, any>>
  implements MessageBroker<T, P>
{
  #isDestroyed = false;
  #sessionId = crypto.randomUUID();
  #eventCounter = 0;
  #subscriptions = new Subscriptions<T>();
  #router: Router<T, P>;
  #hooks: HooksRegistry<T, P>;
  #clientRegistry = new ClientRegistry<T, P>();
  #systemEvents: SystemEvents<T, P>;
  #backpressure: BackpressureHandler;
  #history?: MessageHistory<T, P>;
  #replay?: SubscriptionReplay<T, P>;
  #bridges = new Map<string, Bridge>();
  #inspect: Inspector<T, P>;

  /**
   * Infrastructure logger configured via {@link BrokerConfig.logger}.
   *
   * @internal Used by the facade layer.
   */
  readonly logger: BrokerLogger;

  constructor(config?: BrokerConfig) {
    this.logger = config?.logger ?? defaultLogger;

    this.#hooks = new HooksRegistry(this.logger);
    this.#systemEvents = new SystemEvents(this.logger);
    this.#backpressure = new BackpressureHandler(this.logger);
    this.#router = new Router(this.#subscriptions, this.logger);

    if (config?.history?.enabled) {
      this.#history = new MessageHistory(config.history);
      this.#replay = new SubscriptionReplay(this.#history, this.#hooks, this.logger);
    }

    // Inspector is a read-only facade over internal state: it receives references,
    // not callbacks, so future snapshot methods can be added without changing wiring.
    this.#inspect = new Inspector(
      this.#clientRegistry,
      this.#subscriptions,
      this.#bridges,
      () => this.#history,
    );
  }

  // ========================================
  // SYSTEM EVENTS & INSPECT
  // ========================================

  /**
   * Broker-internal system event channel (push model).
   *
   * The `$` prefix marks this as a broker-internal API. Intended for tooling:
   * DevTools, tracing collectors, metrics integrations.
   *
   * This is NOT for extending broker behaviour — extension hooks are exposed
   * via `useBeforeSendHook`, `useAfterSendHook`, `useOnSubscribeHook`.
   *
   * @example
   * broker.$systemEvents.on('client.registered', ({ clientId }) => { ... });
   * broker.$systemEvents.on('subscription.added', ({ clientId, topic }) => { ... });
   */
  get $systemEvents(): SystemEventsEmitter<T, P> {
    return this.#systemEvents;
  }

  /**
   * Point-in-time state snapshots (pull model).
   *
   * Read-only view over broker state for DevTools and debugging tools.
   *
   * @example
   * const clients = broker.inspect.getClients();
   * const history = broker.inspect.getHistory();
   */
  get inspect(): Inspector<T, P> {
    return this.#inspect;
  }

  // ========================================
  // SUBSCRIPTION MANAGEMENT
  // ========================================

  /**
   * Subscribe a client to a topic.
   *
   * @param clientId - Client identifier
   * @param topic - Topic to subscribe to (e.g. 'user.login.v1')
   * @param handler - Message handler function
   * @param options - Subscription options (backpressure, replay)
   * @throws Error if subscription is blocked on onSubscribe hook
   *
   * @internal Called by {@link BrokerClient.on}. Not part of the public
   * `MessageBroker` contract.
   */
  subscribe(
    clientId: ClientID,
    topic: T,
    handler: MessageHandler,
    options?: SubscriptionOptions,
  ): void {
    if (this.#isDestroyed) {
      this.logger.warn('broker.subscribe.after_destroy', { clientId, topic });
      return;
    }

    // Check if onSubscribe hooks allow this subscription
    const hookResult = this.#hooks.onSubscribe(topic, clientId);

    if (!hookResult.allowed) {
      throw new Error(hookResult.message);
    }

    // Wrap handler with backpressure strategy (if options provided)
    const wrappedHandler = this.#backpressure.wrap(clientId, topic, handler, options);

    // Subscribe with wrapped handler
    this.#subscriptions.subscribe(clientId, topic, wrappedHandler, options);
    this.#systemEvents.emit('subscription.added', { clientId, topic, options });

    // Replay historical messages if requested
    if (options?.replay) {
      if (!this.#replay) {
        this.logger.warn('broker.replay.history_disabled', { clientId, topic });
      } else {
        this.#replay.start(clientId, topic, wrappedHandler, options.replay);
      }
    }
  }

  /**
   * Unsubscribe a client from a topic.
   *
   * @internal Called by {@link BrokerClient.off} / the unsubscribe closure
   * returned by {@link BrokerClient.on}. Not part of the public
   * `MessageBroker` contract.
   */
  unsubscribe(clientId: ClientID, topic: T): void {
    // Remove backpressure strategy (flush pending messages)
    this.#backpressure.remove(clientId, topic);

    if (this.#subscriptions.unsubscribe(clientId, topic)) {
      this.#systemEvents.emit('subscription.removed', { clientId, topic });
    }
  }

  // ========================================
  // MESSAGE DELIVERY
  // ========================================

  /**
   * Process a message originating from a local client.
   *
   * Runs the full lifecycle pipeline: beforeSend → history → routing →
   * afterSend → forward to bridges.
   *
   * @param topic - Type of message
   * @param sender - Client ID of sender
   * @param recipient - Target recipient: specific ClientID (unicast) or '*' (multicast)
   * @param data - Message payload
   * @param options - Message options (history)
   * @returns Promise resolving to RoutingResult with delivery status
   *
   * @internal Called by {@link BrokerClient.emit} / {@link BrokerClient.request}.
   * Not part of the public `MessageBroker` contract.
   */
  async processMessage<K extends T, R = unknown>(
    topic: K,
    sender: ClientID,
    recipient: ClientID | '*',
    data: P[K],
    options?: MessageOptions,
  ): Promise<RoutingResult<R>> {
    return this.#runPipeline<K, R>(topic, sender, recipient, data, options, false);
  }

  /**
   * Shared pipeline body for local {@link processMessage} and external
   * inject wired in {@link addBridge}.
   *
   * Pipeline stages:
   *  1. Create Message (assign id, timestamp) and deep-freeze it.
   *  2. Run `beforeSend` hooks. If any hook denies, short-circuit with
   *     NACK(HOOK_REJECTED) — still fire `afterSend` so observers see the
   *     rejection.
   *  3. Record to history — ONLY for local-origin messages that explicitly
   *     opt in via `options.history`. External (injected) messages are
   *     skipped: the sender-side broker has already recorded them; recording
   *     again here would duplicate on every bridge hop.
   *  4. Route: unicast → one recipient, multicast (`*`) → all subscribers.
   *  5. Run `afterSend` hooks with the delivery result.
   *  6. Forward to bridges — ONLY for local-origin messages. External
   *     messages are never bounced back to bridges; otherwise a bridge would
   *     send what it just received right back to its transport.
   *
   * `fromExternal` gates stages 3 and 6 — the two places where local and
   * external paths diverge. It is an internal flag, never on the public API.
   */
  async #runPipeline<K extends T, R = unknown>(
    topic: K,
    sender: ClientID,
    recipient: ClientID | '*',
    data: P[K],
    options: MessageOptions | undefined,
    fromExternal: boolean,
  ): Promise<RoutingResult<R>> {
    if (this.#isDestroyed) {
      return RoutingResult.create<R>('NACK', RoutingReason.BROKER_DESTROYED, 'Broker is destroyed');
    }

    // Stage 1: Create Message and freeze once
    const message = this.#createMessage(topic, sender, recipient, data);

    if (fromExternal) {
      message.fromExternal = true;
    }

    const frozenMessage = deepFreeze(message);

    // Stage 2: beforeSend hooks (guard)
    const hookResult = this.#hooks.beforeSend(frozenMessage);
    if (!hookResult.allowed) {
      const result = RoutingResult.create<R>(
        'NACK',
        RoutingReason.HOOK_REJECTED,
        hookResult.message,
        recipient !== '*' ? recipient : undefined,
      );
      this.#hooks.afterSend(frozenMessage, result);
      return result;
    }

    // Stage 3: Record to history (only if explicitly requested and not from external)
    if (this.#history && !fromExternal && options?.history === true) {
      this.#history.record(frozenMessage);
    }

    // Multicast never carries response data; the cast widens its phantom R
    // so both branches share the Promise<RoutingResult<R>> return type.
    const result: RoutingResult<R> =
      recipient === '*'
        ? ((await this.#router.multicast(frozenMessage, sender)) as RoutingResult<R>)
        : await this.#router.unicast<K, R>(frozenMessage, recipient);

    // Stage 5: afterSend hooks
    this.#hooks.afterSend(frozenMessage, result);

    // Stage 6: Forward to bridges (only if not from external source)
    if (!fromExternal) {
      this.#forwardToBridges(frozenMessage);
    }

    return result;
  }

  // ========================================
  // BRIDGE MANAGEMENT
  // ========================================

  /**
   * Add a bridge for cross-context communication (idempotent)
   *
   * If a bridge with the given ID already exists, the old bridge is destroyed
   * and replaced with the new one. This prevents duplicate bridges during HMR.
   *
   * @param id - Unique identifier for the bridge (e.g. 'cross-tab', 'iframe-checkout')
   * @param config - Bridge configuration (transport + forward patterns)
   * @returns Function to remove the bridge
   */
  addBridge(id: string, config: BridgeConfig): () => void {
    if (this.#isDestroyed) {
      this.logger.warn('broker.bridge.add.after_destroy', { bridgeId: id });
      return () => {};
    }

    const existing = this.#bridges.get(id);

    if (existing) {
      this.logger.warn('broker.bridge.replaced', { bridgeId: id });
      existing.destroy();
      this.#systemEvents.emit('bridge.removed', { bridgeId: id });
    }

    const inject: ExternalMessageInjector<T, P> = (topic, sender, recipient, data) =>
      this.#runPipeline(topic, sender, recipient, data, undefined, true);

    const bridge = new BridgeImpl<T, P>(inject, config, this.logger);
    this.#bridges.set(id, bridge);
    this.#systemEvents.emit('bridge.added', { bridgeId: id });

    return () => {
      if (this.#bridges.get(id) === bridge) {
        this.#bridges.delete(id);
        bridge.destroy();
        this.#systemEvents.emit('bridge.removed', { bridgeId: id });
      }
    };
  }

  // ========================================
  // CLIENT REGISTRY
  // ========================================

  /**
   * Register a client instance.
   *
   * @internal Called by the `BrokerClient` constructor.
   */
  registerClient(client: BrokerClient<T, P>): void {
    if (this.#isDestroyed) {
      this.logger.warn('broker.client.register.after_destroy', { clientId: client.id });
      return;
    }
    this.#clientRegistry.register(client);
    this.#systemEvents.emit('client.registered', {
      clientId: client.id,
      at: this.#clientRegistry.getConnectedAt(client.id) ?? Date.now(),
    });
  }

  /**
   * Unregister a client and remove all its subscriptions.
   *
   * @internal Called by {@link BrokerClient.destroy}.
   */
  unregisterClient(clientId: ClientID): void {
    const removedTopics = this.#subscriptions.unsubscribeAll(clientId);
    this.#clientRegistry.unregister(clientId);

    for (const topic of removedTopics) {
      this.#systemEvents.emit('subscription.removed', { clientId, topic });
    }
    this.#systemEvents.emit('client.unregistered', { clientId, at: Date.now() });
  }

  /**
   * Get a registered client by ID.
   *
   * @param clientId - Unique client identifier
   * @returns Client instance or undefined if not found
   *
   * @internal Used by the `createClient` facade for idempotency checks.
   */
  getClient(clientId: ClientID): BrokerClient<T, P> | undefined {
    return this.#clientRegistry.get(clientId);
  }

  /**
   * Reset a client: clear all its subscriptions and backpressure strategies
   * while keeping the client registered.
   *
   * Used for idempotent client creation (HMR, re-mounting).
   * Iterates the client's subscriptions and calls unsubscribe() for each,
   * which correctly flushes/destroys backpressure strategies.
   *
   * @param clientId - Unique client identifier
   *
   * @internal Called by {@link BrokerClient.reset} and by the
   * `createClient` facade on idempotent re-creation.
   */
  resetClient(clientId: ClientID): void {
    const topics = this.#subscriptions.getClientTopics(clientId);
    if (topics) {
      for (const topic of [...topics]) {
        this.unsubscribe(clientId, topic);
      }
    }
  }

  // ========================================
  // HOOKS & EXTENSIBILITY
  // ========================================

  /**
   * Register a beforeSend hook
   *
   * Called before routing for ALL messages, including those from bridges.
   * Use message.fromExternal to distinguish local vs external if needed.
   */
  useBeforeSendHook(hook: BeforeSendHook<T, P>): () => void {
    return this.#hooks.addBeforeSendHook(hook);
  }

  /**
   * Register an afterSend hook
   * Note: afterSend hooks are called for ALL messages (check message.fromExternal if needed)
   */
  useAfterSendHook(hook: AfterSendHook<T, P>): () => void {
    return this.#hooks.addAfterSendHook(hook);
  }

  /**
   * Register an onSubscribe hook
   */
  useOnSubscribeHook(hook: OnSubscribeHook<T>): () => void {
    return this.#hooks.addOnSubscribeHook(hook);
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  /**
   * Forward message to all bridges that match the topic
   * @private
   */
  #forwardToBridges(message: Message<T, P[T]>): void {
    for (const bridge of this.#bridges.values()) {
      if (bridge.shouldForward(message.topic)) {
        bridge.send(message);
      }
    }
  }

  /**
   * Create a message with all required fields
   *
   * @private
   */
  #createMessage<K extends T>(
    topic: K,
    sender: ClientID,
    recipient: ClientID | '*',
    data: P[K],
  ): Message<K, P[K]> {
    return {
      id: `${this.#sessionId}-${++this.#eventCounter}`,
      topic: topic,
      source: sender,
      target: recipient,
      data,
      timestamp: Date.now(),
    };
  }

  // ========================================
  // LIFECYCLE & CLEANUP
  // ========================================

  /**
   * Destroy the broker and clean up all resources
   */
  destroy(): void {
    if (this.#isDestroyed) {
      return;
    }
    this.#isDestroyed = true;

    for (const bridge of this.#bridges.values()) {
      bridge.destroy();
    }
    this.#bridges.clear();

    this.#hooks.clear();
    this.#history?.destroy();
    this.#backpressure.destroy();
    this.#subscriptions.clear();
    this.#clientRegistry.clear();
    this.#systemEvents.clear();
  }
}
