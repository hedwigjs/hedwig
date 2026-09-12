import type { Message, ClientID } from '../types';
import type { RoutingResult } from '../routing/RoutingResult';
import type { HookResult, OnSubscribeHook, BeforeSendHook, AfterSendHook } from './HooksRegistry.types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';

/**
 * HooksRegistry — central registry for broker extension hooks.
 *
 * Hook types:
 * - onSubscribe:  guard hook, called on client subscription; can block
 * - beforeSend:   guard hook, called before routing; can block
 * - afterSend:    observer hook, called after routing with delivery result
 *
 * All hooks are executed for ALL messages including those from bridges.
 * Use `message.fromExternal` to distinguish local vs external messages.
 */
export class HooksRegistry<T extends string, P extends Record<T, any>> {
  #onSubscribeHooks: Array<OnSubscribeHook<T>> = [];
  #beforeSendHooks: Array<BeforeSendHook<T, P>> = [];
  #afterSendHooks: Array<AfterSendHook<T, P>> = [];
  #logger: BrokerLogger;

  constructor(logger: BrokerLogger) {
    this.#logger = logger;
  }

  // ========================================
  // REGISTRATION
  // ========================================

  /**
   * Register onSubscribe hook(s).
   * Called whenever a client subscribes to a topic. Return `{ allowed: false }` to block.
   *
   * @returns Cleanup function to remove the hook(s).
   */
  addOnSubscribeHook(hook: OnSubscribeHook<T> | OnSubscribeHook<T>[]): () => void {
    return this.#addHook(this.#onSubscribeHooks, hook);
  }

  /**
   * Register beforeSend hook(s).
   *
   * Called before routing for EVERY message, including those received from bridges.
   * Return `{ allowed: false }` to block delivery.
   *
   * @returns Cleanup function to remove the hook(s).
   */
  addBeforeSendHook(hook: BeforeSendHook<T, P> | BeforeSendHook<T, P>[]): () => void {
    return this.#addHook(this.#beforeSendHooks, hook);
  }

  /**
   * Register afterSend hook(s).
   *
   * Called after each message is processed. Receives the routing result.
   * Called for ALL messages — both local and forwarded from bridges.
   *
   * @returns Cleanup function to remove the hook(s).
   */
  addAfterSendHook(hook: AfterSendHook<T, P> | AfterSendHook<T, P>[]): () => void {
    return this.#addHook(this.#afterSendHooks, hook);
  }

  // ========================================
  // EXECUTION (called by BrokerCore)
  // ========================================

  /**
   * Execute onSubscribe hooks. Stops at the first hook that denies.
   */
  onSubscribe(topic: T, clientId: ClientID): HookResult {
    return this.#runGuard(this.#onSubscribeHooks, 'onSubscribe', (hook) =>
      hook(topic, clientId),
    );
  }

  /**
   * Execute beforeSend hooks. Stops at the first hook that denies.
   * Executed for ALL messages, including those from bridges.
   */
  beforeSend(message: Readonly<Message<T, P[T]>>): HookResult {
    return this.#runGuard(this.#beforeSendHooks, 'beforeSend', (hook) => hook(message));
  }

  /**
   * Execute afterSend hooks. All hooks run; errors are isolated per-hook.
   * Executed for ALL messages (local and external).
   */
  afterSend(message: Readonly<Message<T, P[T]>>, messageResult: RoutingResult): void {
    // Iterate a snapshot: a hook that removes itself (or another hook) via
    // the cleanup function splices the live array and would skip the next
    // hook. Same rule as Router: removal takes effect from the next message.
    const hooks = this.#afterSendHooks;
    if (hooks.length === 0) return;
    for (const hook of hooks.slice()) {
      try {
        hook(message, messageResult);
      } catch (error) {
        this.#logger.error('hook.after_send.failed', { error });
      }
    }
  }

  // ========================================
  // LIFECYCLE
  // ========================================

  /**
   * Remove all registered hooks.
   */
  clear(): void {
    this.#onSubscribeHooks = [];
    this.#beforeSendHooks = [];
    this.#afterSendHooks = [];
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Add one or more hooks to a list and return an unsubscribe function.
   * Preserves insertion order for deterministic hook execution.
   */
  #addHook<H>(list: H[], hookOrHooks: H | H[]): () => void {
    const added = Array.isArray(hookOrHooks) ? [...hookOrHooks] : [hookOrHooks];
    list.push(...added);

    return () => {
      for (const hook of added) {
        const index = list.indexOf(hook);
        if (index !== -1) list.splice(index, 1);
      }
    };
  }

  /**
   * Run a list of guard-style hooks: each returns HookResult, execution stops
   * at the first `{ allowed: false }`. Errors are caught and logged (fail-open):
   * a throwing hook does not block the pipeline.
   *
   * Iterates a snapshot of the list so a hook that removes itself mid-run
   * cannot cause the next hook to be skipped.
   */
  #runGuard<H extends (...args: any[]) => HookResult>(
    hooks: H[],
    kind: string,
    invoke: (hook: H) => HookResult,
  ): HookResult {
    if (hooks.length === 0) return { allowed: true };
    for (const hook of hooks.slice()) {
      try {
        const result = invoke(hook);
        if (!result.allowed) return result;
      } catch (error) {
        this.#logger.error('hook.failed', { kind, error });
      }
    }
    return { allowed: true };
  }
}
