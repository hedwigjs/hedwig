import { BrokerCore } from './core/BrokerCore';
import { BrokerClient } from './core/client/BrokerClient';
import { VERSION, GLOBAL_REGISTRY_KEY, isCompatibleVersion } from './core/version';
import type { BrokerConfig } from './core/types';
import type { MessageBroker } from './core/MessageBroker';
import type { Client } from './core/client/Client.types';
import type { RemoteClient, RemoteClientOptions } from './core/remote/RemoteClient.types';

/**
 * Per-realm slot: the one live core and the version of the copy that
 * created it.
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
interface Slot {
  core: BrokerCore<any, any> | null;
  version: string;
}

function slot(): Slot {
  const g = globalThis as unknown as Record<symbol, Slot | undefined>;
  let s = g[GLOBAL_REGISTRY_KEY];
  if (!s) {
    s = { core: null, version: VERSION };
    Object.defineProperty(globalThis, GLOBAL_REGISTRY_KEY, {
      value: s,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return s;
}

/**
 * The core THIS copy of the module has already adopted. Compared by identity
 * against the slot: when they differ, the slot was filled by another copy of
 * the library (or by this module before an HMR replacement), and we flag it
 * once as a duplicate copy.
 */
let adopted: BrokerCore<any, any> | null = null;

/**
 * Resolve the realm's broker for this copy of the library.
 *
 * @throws if a broker exists but was created by an incompatible version —
 *   never a second bus, always a loud failure.
 */
function resolve(): BrokerCore<any, any> | null {
  const s = slot();
  const core = s.core;
  if (!core) return null;

  if (adopted !== core) {
    if (!isCompatibleVersion(s.version, VERSION)) {
      core.logger.error('broker.version_incompatible', {
        existing: s.version,
        thisCopy: VERSION,
      });
      throw new Error(
        `@hedwigjs/broker: a broker of version ${s.version} already exists in this realm, ` +
          `but this copy of the library is ${VERSION}. Copies must share the same minor ` +
          `before 1.0 (same major after). Align @hedwigjs/broker across the host and every ` +
          `module, or share it as a singleton in your bundler.`,
      );
    }
    adopted = core;
    core.noteDuplicateCopy?.(VERSION);
  }
  return core;
}

/**
 * Initialize the message broker (idempotent, one instance per realm).
 *
 * Called once by the host application (e.g. the shell / app bootstrap).
 * If a broker already exists in this realm — created by this or by any
 * other compatible copy of the library — it is returned unchanged; a second
 * copy is reported as `broker.duplicate_copy`. An incompatible copy throws.
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
  const s = slot();
  s.core = core;
  s.version = VERSION;
  adopted = core;
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
 * @throws Error if the broker has not been initialized, or was created by an
 *   incompatible version of the library.
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

  if (core.getRemoteClient(id)) {
    throw new Error(
      `@hedwigjs/broker: client id '${id}' is already taken by a remote client. Local and remote clients share one namespace.`,
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
 * Register a remote participant on the current broker. Shorthand for
 * `getBroker().createRemoteClient(id, options)`; see
 * {@link MessageBroker.createRemoteClient}.
 *
 * @example
 * const backend = createRemoteClient('notifications-backend', {
 *   transport: { kind: 'websocket', socket },
 *   accepts: ['notification.*'],
 * });
 *
 * @throws Error if the broker has not been initialized, or was created by an
 *   incompatible version of the library.
 */
export function createRemoteClient(id: string, options: RemoteClientOptions): RemoteClient {
  const core = resolve();
  if (!core) {
    throw new Error(
      'MessageBroker not initialized. Call initBroker(config) first.',
    );
  }
  return core.createRemoteClient(id, options);
}

/**
 * Get the current broker instance.
 *
 * Use when you need access to broker methods (hooks, `$systemEvents`,
 * `inspect`, `createRemoteClient`) without holding the reference returned by
 * {@link initBroker}.
 *
 * Types can be passed explicitly: `getBroker<MyTopics, MyPayloads>()`.
 *
 * @throws Error if the broker has not been initialized, or was created by an
 *   incompatible version of the library.
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
 * Destroys remote clients, clears subscriptions, history, and the client registry,
 * and frees the realm-wide slot so the next `initBroker()` — from any copy
 * of the library — starts fresh.
 */
export function destroyBroker(): void {
  const s = slot();
  s.core?.destroy();
  s.core = null;
  adopted = null;
}
