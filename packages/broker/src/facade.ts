import { BrokerCore } from './core/BrokerCore';
import { BrokerClient } from './core/client/BrokerClient';
import type { BrokerConfig } from './core/types';
import type { MessageBroker } from './core/MessageBroker';
import type { Client } from './core/client/Client.types';

let core: BrokerCore<any, any> | null = null;

/**
 * Initialize the message broker (idempotent).
 *
 * Called once by the host application (e.g. the shell / app bootstrap).
 * If the broker is already initialized, the existing instance is returned
 * without changes. To reinitialize, call {@link destroyBroker} first.
 *
 * @param config - Broker configuration (history, etc.).
 * @returns The broker instance typed against the caller's Topics/Payloads.
 */
export function initBroker<
  T extends string = string,
  P extends Record<T, any> = any,
>(config?: BrokerConfig): MessageBroker<T, P> {
  if (core) {
    return core as MessageBroker<T, P>;
  }

  core = new BrokerCore<T, P>(config);
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
 * Destroys bridges, clears subscriptions, history, and the client registry.
 */
export function destroyBroker(): void {
  core?.destroy();
  core = null;
}
