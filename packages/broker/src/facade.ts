import { BrokerCore } from './core/BrokerCore';
import { BrokerClient } from './core/client/BrokerClient';
import { PROTOCOL_VERSION, GLOBAL_REGISTRY_KEY } from './core/protocol';
import type { BrokerConfig } from './core/types';
import type { MessageBroker } from './core/MessageBroker';
import type { Client } from './core/client/Client.types';

/**
 * Per-realm registry: protocol version → live core.
 *
 * Lives on `globalThis` under {@link GLOBAL_REGISTRY_KEY} so that every copy
 * of this module on the page (Module Federation without `singleton: true`,
 * two bundlers, ESM + CJS dual-package hazard) resolves to the SAME broker.
 * The property is non-enumerable and non-writable: it never shows up in
 * `Object.keys(globalThis)` and cannot be clobbered by a stray assignment.
 *
 * Hygiene, not security — any script in the realm could already reach the
 * broker through the module graph. See the threat-model doc.
 */
type Registry = Record<number, BrokerCore<any, any> | undefined>;

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  let reg = g[GLOBAL_REGISTRY_KEY];
  if (!reg) {
    reg = Object.create(null) as Registry;
    Object.defineProperty(globalThis, GLOBAL_REGISTRY_KEY, {
      value: reg,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return reg;
}

/**
 * The core THIS copy of the module has already adopted. Compared by identity
 * against the registry slot: when they differ, the slot was filled by another
 * copy of the library (or by this module before an HMR replacement), and we
 * flag it once as a duplicate copy.
 */
let adopted: BrokerCore<any, any> | null = null;

function resolve(): BrokerCore<any, any> | null {
  const core = registry()[PROTOCOL_VERSION] ?? null;
  if (core && adopted !== core) {
    adopted = core;
    core.noteDuplicateCopy?.();
  }
  return core;
}

/**
 * Initialize the message broker (idempotent, one instance per realm).
 *
 * Called once by the host application (e.g. the shell / app bootstrap).
 * If a broker of the same {@link PROTOCOL_VERSION} already exists in this
 * realm — created by this or by any other copy of the library — it is
 * returned unchanged; a second copy is reported as `broker.duplicate_copy`.
 * To reinitialize, call {@link destroyBroker} first.
 *
 * @param config - Broker configuration (history, logger, debug).
 * @returns The broker instance typed against the caller's Topics/Payloads.
 */
export function initBroker<
  T extends string = string,
  P extends Record<T, any> = any,
>(config?: BrokerConfig): MessageBroker<T, P> {
  const existing = resolve();
  if (existing) {
    return existing as MessageBroker<T, P>;
  }

  const core = new BrokerCore<T, P>(config);
  const reg = registry();
  reg[PROTOCOL_VERSION] = core;
  adopted = core;

  const otherVersions = Object.keys(reg)
    .map(Number)
    .filter((v) => v !== PROTOCOL_VERSION && reg[v] !== undefined);
  if (otherVersions.length > 0) {
    core.noteProtocolMismatch(otherVersions);
  }

  return core as MessageBroker<T, P>;
}

/**
 * Create or retrieve a client for message communication (idempotent).
 *
 * If a client with the given ID already exists, its subscriptions and
 * backpressure strategies are reset and the existing instance is returned.
 * Safe for HMR and component re-mounting scenarios.
 *
 * Pass explicit type parameters to get a fully typed client without a cast:
 *
 * @example
 * import type { Topic, TopicPayloads } from '@hedwigjs/registry';
 * const client = createClient<Topic, TopicPayloads>('cart');
 *
 * @param id - Unique identifier for the client.
 * @throws Error if the broker has not been initialized.
 */
export function createClient<
  T extends string = string,
  P extends Record<T, any> = any,
>(id: string): Client<T, P> {
  const core = resolve();
  if (!core) {
    throw new Error(
      'MessageBroker not initialized. Call initBroker(config) first.',
    );
  }

  const existing = core.getClient(id);

  if (existing) {
    core.logger.warn('facade.createClient.reset', { clientId: id });
    core.resetClient(id);
    return existing as Client<T, P>;
  }
  return new BrokerClient<T, P>(id, core as BrokerCore<T, P>);
}

/**
 * Get the current broker instance.
 *
 * Use when you need access to broker methods (hooks, `$systemEvents`,
 * `inspect`, `addBridge`) without holding the reference returned by
 * {@link initBroker}.
 *
 * Types can be passed explicitly: `getBroker<MyTopics, MyPayloads>()`.
 *
 * @throws Error if the broker has not been initialized.
 */
export function getBroker<
  T extends string = string,
  P extends Record<T, any> = any,
>(): MessageBroker<T, P> {
  const core = resolve();
  if (!core) {
    throw new Error(
      'MessageBroker not initialized. Call initBroker(config) first.',
    );
  }
  return core as MessageBroker<T, P>;
}

/**
 * Destroy the broker and release all resources.
 *
 * Destroys bridges, clears subscriptions, history, and the client registry,
 * and frees the realm-wide slot so the next `initBroker()` — from any copy
 * of the library — starts fresh.
 */
export function destroyBroker(): void {
  const reg = registry();
  const core = reg[PROTOCOL_VERSION];
  core?.destroy();
  delete reg[PROTOCOL_VERSION];
  adopted = null;
}
