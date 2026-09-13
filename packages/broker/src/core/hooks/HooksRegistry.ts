import type { Message, ClientID } from '../types';
import type { RoutingResult } from '../routing/RoutingResult';
import type { HookResult, OnSubscribeHook, BeforeSendHook, AfterSendHook } from './HooksRegistry.types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';

export type HookFailMode = 'open' | 'closed';

/** Payload handed to {@link HooksRegistryOptions.onHookFailed}. */
export interface HookFailure {
  kind: 'beforeSend' | 'onSubscribe' | 'afterSend';
  failMode: HookFailMode;
  error: unknown;
  topic?: string;
  messageId?: string;
  source?: ClientID;
  clientId?: ClientID;
}

export interface HooksRegistryOptions {
  /** What to do when a guard hook throws. See `BrokerConfig.hooks.failMode`. */
  failMode: HookFailMode;
  /** Called for every throwing hook, guard or observer. Used to publish `hook.failed`. */
  onHookFailed?: (failure: HookFailure) => void;
}

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
 *
 * A throwing guard hook is a denial under `failMode: 'closed'` (default)
 * and is skipped under `'open'`. Either way the failure is logged and
 * reported through `onHookFailed`. Observer hooks are always isolated.
 */
export class HooksRegistry<T extends string, P extends Record<T, any>> {
  #onSubscribeHooks: Array<OnSubscribeHook<T>> = [];
  #beforeSendHooks: Array<BeforeSendHook<T, P>> = [];
  #afterSendHooks: Array<AfterSendHook<T, P>> = [];
  #logger: BrokerLogger;
  #failMode: HookFailMode;
  #onHookFailed?: (failure: HookFailure) => void;

  constructor(logger: BrokerLogger, options: HooksRegistryOptions = { failMode: 'closed' }) {
    this.#logger = logger;
    this.#failMode = options.failMode;
    this.#onHookFailed = options.onHookFailed;
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
    return this.#runGuard(this.#onSubscribeHooks, 'onSubscribe', (hook) => hook(topic, clientId), {
      topic,
      clientId,
    });
  }

  /**
   * Execute beforeSend hooks. Stops at the first hook that denies.
   * Executed for ALL messages, including those from bridges.
   */
  beforeSend(message: Readonly<Message<T, P[T]>>): HookResult {
    return this.#runGuard(this.#beforeSendHooks, 'beforeSend', (hook) => hook(message), {
      topic: message.topic,
      messageId: message.id,
      source: message.source,
    });
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
        const context = { topic: message.topic, messageId: message.id, source: message.source };
        this.#logger.error('hook.after_send.failed', { ...context, error });
        this.#report({ kind: 'afterSend', failMode: this.#failMode, error, ...context });
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
   * at the first `{ allowed: false }`.
   *
   * A throwing hook is logged and reported; under `failMode: 'closed'` it
   * also denies (a crashing ACL must not let traffic through), under
   * `'open'` it is skipped.
   *
   * Iterates a snapshot of the list so a hook that removes itself mid-run
   * cannot cause the next hook to be skipped.
   */
  #runGuard<H extends (...args: any[]) => HookResult>(
    hooks: H[],
    kind: 'beforeSend' | 'onSubscribe',
    invoke: (hook: H) => HookResult,
    context: Pick<HookFailure, 'topic' | 'messageId' | 'source' | 'clientId'>,
  ): HookResult {
    if (hooks.length === 0) return { allowed: true };
    for (const hook of hooks.slice()) {
      try {
        const result = invoke(hook);
        if (!result.allowed) return result;
      } catch (error) {
        this.#logger.error('hook.failed', { kind, failMode: this.#failMode, ...context, error });
        this.#report({ kind, failMode: this.#failMode, error, ...context });
        if (this.#failMode === 'closed') {
          return {
            allowed: false,
            message: `${kind} hook threw (${describe(error)}); denied because hooks fail closed`,
          };
        }
      }
    }
    return { allowed: true };
  }

  #report(failure: HookFailure): void {
    try {
      this.#onHookFailed?.(failure);
    } catch {
      // The reporter is broker-internal (system events, error-isolated);
      // nothing sensible left to do if it throws.
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
