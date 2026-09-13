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
import { generateUUID } from './utils/uuid';
import { VERSION } from './version';
import { defaultLogger } from './logger/BrokerLogger.types';
import { createSafeLogger } from './logger/safeLogger';
import { RemoteClientImpl } from './remote/RemoteClient';
import { createTransport, BUILT_IN_TRANSPORT_KINDS } from './transport/createTransport';
import { isTransportDescriptor } from './transport/Transport.types';

import type {
  Message,
  ClientID,
  MessageHandler,
  SubscriptionOptions,
  BrokerConfig,
  MessageOptions,
  RequestOptions,
} from './types';
import type { BrokerLogger } from './logger/BrokerLogger.types';
import type { BrokerClient } from './client/BrokerClient';
import type { OnSubscribeHook, BeforeSendHook, AfterSendHook } from './hooks/HooksRegistry.types';
import type { SystemEventsEmitter, SystemEventPayload } from './events/SystemEvents.types';
import type { RemoteClient, RemoteClientOptions } from './remote/RemoteClient.types';
import type { Transport } from './transport/Transport.types';
import type { MessageBroker } from './MessageBroker';

/**
 * BrokerCore — low-level message broker engine, internal implementation
 * of the public {@link MessageBroker} interface.
 *
 * Responsibilities:
 * - Message routing and delivery pipeline (hooks → routing → history → remote clients)
 * - Subscription management (delegates to Subscriptions)
 * - Coordinate Router, HooksRegistry, ClientRegistry
 * - Remote clients: participants that live behind a transport
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
 * BrokerClient, RemoteClientImpl and the facade — they are stable only inside the
 * package and may change without notice.
 */
export class BrokerCore<T extends string, P extends Record<T, any>>
  implements MessageBroker<T, P>
{
  #isDestroyed = false;
  // Session label baked into every message id. `generateUUID` works outside
  // secure contexts too — `crypto.randomUUID` alone would throw on plain-http
  // intranet hosts and take `initBroker()` down with it.
  #sessionId = generateUUID();
  #eventCounter = 0;
  #subscriptions = new Subscriptions<T>();
  #router: Router<T, P>;
  #hooks: HooksRegistry<T, P>;
  #clientRegistry = new ClientRegistry<T, P>();
  #systemEvents: SystemEvents<T, P>;
  #backpressure: BackpressureHandler;
  #history?: MessageHistory<T, P>;
  #replay?: SubscriptionReplay<T, P>;
  #remotes = new Map<string, RemoteClientImpl>();
  #inspect: Inspector<T, P>;

  /**
   * What this runtime can do, as stable strings (`transport.websocket`, …).
   * The client SDK reads this before relying on a feature.
   */
  readonly capabilities: ReadonlySet<string> = new Set(
    BUILT_IN_TRANSPORT_KINDS.map((kind) => `transport.${kind}`),
  );

  /**
   * Package version of the copy that created this instance. Other copies
   * of the library compare against it before adopting the instance;
   * DevTools compares it with the version it was built against.
   */
  readonly version: string = VERSION;
  #duplicateCopies = 0;
  #debugEnabled: boolean;
  #requestTimeout: number | undefined;
  /** Topics already warned about for `history: true` on a request. */
  #warnedRequestHistory = new Set<string>();

  /**
   * Infrastructure logger configured via {@link BrokerConfig.logger}.
   *
   * Always wrapped by {@link createSafeLogger}: a throwing user logger is
   * reported to `console.error` and never propagates into the pipeline.
   *
   * @internal Used by the facade layer.
   */
  readonly logger: BrokerLogger;

  constructor(config?: BrokerConfig) {
    this.logger = createSafeLogger(config?.logger ?? defaultLogger);
    this.#debugEnabled = config?.debug === true;
    this.#requestTimeout = config?.request?.timeout;

    // System events first: the hooks registry reports failures through them.
    this.#systemEvents = new SystemEvents(this.logger);
    this.#hooks = new HooksRegistry(this.logger, {
      failMode: config?.hooks?.failMode ?? 'closed',
      onHookFailed: (failure) =>
        this.#systemEvents.emit('hook.failed', failure as SystemEventPayload<T, P, 'hook.failed'>),
    });
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
      this.#remotes,
      () => this.#history,
      () => ({
        version: this.version,
        duplicateCopies: this.#duplicateCopies,
      }),
    );
  }

  // ========================================
  // REALM SINGLETON DIAGNOSTICS
  // ========================================

  /**
   * Record that another (compatible) copy of the library adopted this
   * instance through the realm registry. Logged and published so tooling
   * can show that the page bundles `@hedwigjs/broker` more than once.
   *
   * @param copyVersion - Package version of the adopting copy.
   * @internal Called by the facade.
   */
  noteDuplicateCopy(copyVersion: string): void {
    this.#duplicateCopies += 1;
    const payload = {
      version: this.version,
      copyVersion,
      copies: this.#duplicateCopies,
      at: Date.now(),
    };
    this.logger.warn('broker.duplicate_copy', payload);
    this.#systemEvents.emit('broker.duplicate_copy', payload);
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
   * Multiple handlers may be attached to the same `(clientId, topic)` pair —
   * each call returns a distinct subscription id that identifies THIS
   * handler for later removal via {@link unsubscribeOne}.
   *
   * @returns Subscription id, or `0` when the call was a no-op (broker
   *          destroyed). Zero is never a valid id.
   *
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
  ): number {
    if (this.#isDestroyed) {
      this.logger.warn('broker.subscribe.after_destroy', { clientId, topic });
      return 0;
    }

    const hookResult = this.#hooks.onSubscribe(topic, clientId);
    if (!hookResult.allowed) {
      // Surface the denial on the system-events channel so observability
      // tools (DevTools, audit loggers) see it. Then throw — throwing keeps
      // the failure locally observable at the call site as well.
      this.#systemEvents.emit('subscription.rejected', {
        clientId,
        topic,
        reason: hookResult.message,
      });
      throw new Error(hookResult.message);
    }

    // Reserve id first so backpressure keys its strategy by the same value
    // we hand back to the caller.
    const subscriptionId = this.#subscriptions.reserveId();
    const wrappedHandler = this.#backpressure.wrap(
      subscriptionId,
      clientId,
      topic,
      handler,
      options,
    );

    // The raw handler rides along so unicast can bypass the backpressure
    // wrapper — a request must always be answered.
    this.#subscriptions.subscribe(clientId, topic, wrappedHandler, options, subscriptionId, handler);
    this.#systemEvents.emit('subscription.added', { clientId, topic, options });

    if (options?.replay) {
      if (!this.#replay) {
        this.logger.warn('broker.replay.history_disabled', { clientId, topic });
      } else {
        // Synchronous: the handler sees every matching history entry before
        // `on()` returns, so nothing emitted afterwards can overtake or
        // duplicate them. See SubscriptionReplay for the reasoning.
        this.#replay.start(clientId, topic, wrappedHandler, options.replay);
      }
    }
    return subscriptionId;
  }

  /**
   * Unsubscribe a client from a topic — removes every handler this client
   * has attached to the topic.
   *
   * @internal Called by {@link BrokerClient.off}. Not part of the public
   * `MessageBroker` contract.
   */
  unsubscribe(clientId: ClientID, topic: T): void {
    const removed = this.#subscriptions.unsubscribe(clientId, topic);
    if (removed.length === 0) return;

    for (const entry of removed) {
      this.#backpressure.removeOne(entry.id);
    }
    this.#systemEvents.emit('subscription.removed', { clientId, topic });
  }

  /**
   * Unsubscribe a single handler by its subscription id.
   *
   * Fires `subscription.removed` only if this was the last handler that
   * client had on the topic — otherwise the client is still subscribed.
   *
   * @internal Called by the unsubscribe closure returned from {@link BrokerClient.on}.
   */
  unsubscribeOne(subscriptionId: number): void {
    if (subscriptionId === 0) return;
    const outcome = this.#subscriptions.unsubscribeOne(subscriptionId);
    if (!outcome) return;

    this.#backpressure.removeOne(outcome.entry.id);

    // Only surface subscription.removed when the pair is fully drained —
    // otherwise the client is still subscribed via other handlers.
    if (outcome.wasLast) {
      this.#systemEvents.emit('subscription.removed', {
        clientId: outcome.clientId,
        topic: outcome.topic,
      });
    }
  }

  // ========================================
  // MESSAGE DELIVERY
  // ========================================

  /**
   * Process a message originating from a local client.
   *
   * Runs the full lifecycle pipeline: beforeSend → history → routing →
   * afterSend → forward to remote clients.
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
    options?: RequestOptions,
  ): Promise<RoutingResult<R>> {
    if (recipient !== '*' && options?.history === true && !this.#warnedRequestHistory.has(topic)) {
      // Replaying a request re-runs a command with no requester to answer.
      // Retention is an event concern; this option goes away for unicast.
      this.#warnedRequestHistory.add(topic);
      this.logger.warn('request.history_deprecated', { topic, recipient });
    }
    return this.#runPipeline<K, R>(topic, sender, recipient, data, options, false, false);
  }

  /**
   * Broker-internal debug channel.
   *
   * `send()` runs the full message pipeline exactly like a normal
   * `Client.emit()` / `Client.request()` — routing, hooks, history and
   * forwarding to remote clients all apply — but with two differences:
   *
   *  1. `source` is an arbitrary string, not tied to a registered client.
   *     Nothing gets reset in the client registry: safe to «impersonate»
   *     any client id for testing subscribers without breaking that
   *     client's own subscriptions.
   *  2. `message.synthetic === true` on the resulting Message, so
   *     DevTools and integration tests can distinguish spoofed traffic
   *     from production events (e.g. render a `SYNTHETIC` badge).
   *
   * Multicast vs unicast is picked by `target`: `'*'` fans out to all
   * subscribers, a specific `ClientID` targets one recipient and captures
   * that handler's return value in `RoutingResult.data`.
   *
   * The `$` prefix marks this as a broker-internal API — for DevTools
   * and integration tests, not for business code.
   *
   * Gated by `BrokerConfig.debug`. When the broker was booted without
   * `debug: true`, `send()` resolves `NACK DEBUG_DISABLED` without
   * touching the pipeline and logs `debug.disabled`; `enabled` tells
   * tooling which state it is in so it can explain instead of failing.
   */
  get $debug(): {
    readonly enabled: boolean;
    send<K extends T, R = unknown>(
      source: ClientID,
      topic: K,
      target: ClientID | '*',
      data: P[K],
      options?: MessageOptions,
    ): Promise<RoutingResult<R>>;
  } {
    return {
      enabled: this.#debugEnabled,
      send: <K extends T, R = unknown>(
        source: ClientID,
        topic: K,
        target: ClientID | '*',
        data: P[K],
        options?: MessageOptions,
      ): Promise<RoutingResult<R>> => {
        if (!this.#debugEnabled) {
          this.logger.warn('debug.disabled', { source, topic, target });
          return Promise.resolve(
            RoutingResult.create<R>(
              'NACK',
              RoutingReason.DEBUG_DISABLED,
              'Debug channel is disabled. Boot the broker with initBroker({ debug: true }).',
              target !== '*' ? target : undefined,
            ),
          );
        }
        return this.#runPipeline<K, R>(topic, source, target, data, options, false, true);
      },
    };
  }

  /**
   * Shared pipeline body for local {@link processMessage} and frames
   * injected by remote clients ({@link createRemoteClient}).
   *
   * Pipeline stages:
   *  1. Create Message (assign id, timestamp) and deep-freeze it.
   *  2. Run `beforeSend` hooks. If any hook denies, short-circuit with
   *     NACK(HOOK_REJECTED) — still fire `afterSend` so observers see the
   *     rejection.
   *  3. Record to history — ONLY for local-origin messages that explicitly
   *     opt in via `options.history`. External (injected) messages are
   *     skipped: the sender-side broker has already recorded them; recording
   *     again here would duplicate on every hop between realms.
   *  4. Route: unicast → one recipient, multicast (`*`) → all subscribers.
   *  5. Run `afterSend` hooks with the delivery result.
   *  6. Forward to remote clients — ONLY for local-origin multicasts.
   *     External messages are never bounced back; otherwise a remote
   *     would get what it just sent right back over its transport.
   *
   * `fromExternal` gates stages 3 and 6 — the two places where local and
   * external paths diverge. `synthetic` is metadata-only: routing, hooks,
   * history and forwarding all treat the message as real. Both
   * flags are internal — never on the public API.
   */
  async #runPipeline<K extends T, R = unknown>(
    topic: K,
    sender: ClientID,
    recipient: ClientID | '*',
    data: P[K],
    options: RequestOptions | undefined,
    fromExternal: boolean,
    synthetic: boolean,
    via?: string,
  ): Promise<RoutingResult<R>> {
    if (this.#isDestroyed) {
      return RoutingResult.create<R>('NACK', RoutingReason.BROKER_DESTROYED, 'Broker is destroyed');
    }

    // Stage 1: Create Message and freeze once
    const message = this.#createMessage(topic, sender, recipient, data);

    if (fromExternal) {
      message.fromExternal = true;
    }
    if (via !== undefined) {
      message.via = via;
    }
    if (synthetic) {
      message.synthetic = true;
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
      // Publish the denial to system events too — same rationale as
      // `subscription.rejected`: give observers a dedicated stream of
      // security signals independent from the delivery-result channel.
      this.#systemEvents.emit('message.rejected', {
        source: sender,
        target: recipient,
        topic,
        reason: hookResult.message,
      });
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
        : await this.#router.unicast<K, R>(
            frozenMessage,
            recipient,
            options?.timeout ?? this.#requestTimeout,
          );

    // Stage 5: afterSend hooks
    this.#hooks.afterSend(frozenMessage, result);

    // Stage 6: Forward to remote clients — local multicasts only. A frame
    // that came in over a transport is never echoed back, and a unicast
    // never crosses the wire: its recipient is resolved locally
    // (NOT_SUBSCRIBED otherwise)
    // and its result could not come back over the wire, so forwarding it
    // would execute a command remotely while reporting failure here.
    if (!fromExternal && recipient === '*') {
      this.#forwardToRemotes(frozenMessage);
    }

    return result;
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
    if (this.#remotes.has(client.id)) {
      throw clientIdTaken(client.id, 'a remote client');
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
    const removed = this.#subscriptions.unsubscribeAll(clientId);
    this.#clientRegistry.unregister(clientId);

    for (const bucket of removed) {
      for (const entry of bucket.entries) {
        this.#backpressure.removeOne(entry.id);
      }
      this.#systemEvents.emit('subscription.removed', { clientId, topic: bucket.topic });
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
   * Called before routing for ALL messages, including those from remote clients.
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
   * Forward a local multicast to every remote client whose `forward`
   * patterns match the topic.
   *
   * Each remote is isolated: a transport that throws on `send()` (or never
   * becomes ready) is reported as `remote.send.failed` and skipped, so the
   * remaining remotes still receive the message and the caller's `emit()`
   * promise resolves normally. Local delivery has already happened by the
   * time this runs — a throwing wire must not retroactively turn that into
   * a rejection.
   */
  #forwardToRemotes(message: Message<T, P[T]>): void {
    for (const remote of this.#remotes.values()) {
      if (remote.matchesForward(message.topic)) {
        remote.send(message);
      }
    }
  }

  // ========================================
  // REMOTE CLIENTS
  // ========================================

  /**
   * Register a participant that lives on the far side of a transport.
   * See {@link RemoteClient} for the model. The id must be free: local and
   * remote clients share one namespace (`CLIENT_ID_TAKEN` otherwise).
   */
  createRemoteClient(id: string, options: RemoteClientOptions): RemoteClient {
    if (this.#isDestroyed) {
      throw new Error(`@hedwigjs/broker: cannot create remote client '${id}' — broker is destroyed`);
    }
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('@hedwigjs/broker: remote client id must be a non-empty string');
    }
    if (this.#clientRegistry.has(id)) throw clientIdTaken(id, 'a local client');
    if (this.#remotes.has(id)) throw clientIdTaken(id, 'a remote client');

    const descriptor = options.transport;
    let transport: Transport;
    let kind: string;
    if (isTransportDescriptor(descriptor)) {
      transport = createTransport(descriptor);
      kind = descriptor.kind;
    } else {
      transport = descriptor;
      kind = 'custom';
    }

    const remote = new RemoteClientImpl(id, kind, transport, options, {
      logger: this.logger,
      inject: (remoteId, topic, source, target, data) =>
        this.#runPipeline(topic as T, source, target, data as P[T], undefined, true, false, remoteId),
      onSubscribe: (topic, clientId) => this.#hooks.onSubscribe(topic as T, clientId),
      subscriptionAdded: (clientId, topic) =>
        this.#systemEvents.emit('subscription.added', { clientId, topic: topic as T }),
      subscriptionRemoved: (clientId, topic) =>
        this.#systemEvents.emit('subscription.removed', { clientId, topic: topic as T }),
      subscriptionRejected: (clientId, topic, reason) =>
        this.#systemEvents.emit('subscription.rejected', { clientId, topic: topic as T, reason }),
      frameRejected: (remoteId, reason, claimed) => {
        this.logger.warn('remote.frame.rejected', { remoteId, reason, ...claimed });
        this.#systemEvents.emit('remote.frame.rejected', { remoteId, reason, ...claimed });
      },
      sendFailed: (remoteId, topic, messageId, reason, error) => {
        const payload = { remoteId, topic: topic as T, messageId, reason: reason as 'TRANSPORT_THREW' | 'NOT_OPEN', error };
        this.logger.error('remote.send.failed', payload);
        this.#systemEvents.emit('remote.send.failed', payload);
      },
      destroyed: (remoteId) => {
        if (this.#remotes.get(remoteId) !== remote) return;
        this.#remotes.delete(remoteId);
        const at = Date.now();
        this.#systemEvents.emit('remote.destroyed', { remoteId, at });
        this.#systemEvents.emit('client.unregistered', { clientId: remoteId, at });
      },
    });

    // Registered before the initial `forward` so a policy denial there
    // rolls the remote back cleanly instead of leaking the transport.
    this.#remotes.set(id, remote);
    try {
      if (options.forward && options.forward.length > 0) {
        remote.forward(options.forward);
      }
    } catch (error) {
      this.#remotes.delete(id);
      remote.destroy();
      throw error;
    }

    const at = remote.createdAt;
    this.#systemEvents.emit('remote.created', { remoteId: id, kind, identity: remote.identity, at });
    this.#systemEvents.emit('client.registered', { clientId: id, at });
    return remote;
  }

  /** Remote client by id, if registered. */
  getRemoteClient(id: string): RemoteClient | undefined {
    return this.#remotes.get(id);
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

    for (const remote of Array.from(this.#remotes.values())) {
      remote.destroy();
    }
    this.#remotes.clear();

    this.#hooks.clear();
    this.#history?.destroy();
    // Release per-handler backpressure strategies via the cleared entries,
    // then run destroy() as a belt-and-suspenders sweep for anything that
    // somehow escaped bookkeeping.
    const cleared = this.#subscriptions.clear();
    for (const entry of cleared) {
      this.#backpressure.removeOne(entry.id);
    }
    this.#backpressure.destroy();
    this.#clientRegistry.clear();
    this.#systemEvents.clear();
  }
}

function clientIdTaken(id: string, holder: string): Error {
  const error = new Error(
    `@hedwigjs/broker: client id '${id}' is already taken by ${holder}. Local and remote clients share one namespace.`,
  );
  (error as Error & { code: string }).code = 'CLIENT_ID_TAKEN';
  return error;
}
