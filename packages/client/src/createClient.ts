import type { Client, ClientOptions } from './types/client';
import type { TopicContractsMap } from './types/contracts';
import type { RemoteClient, RemoteClientOptions } from './types/remote';
import type { ClientMeta } from './handle';
import { ABI } from './handle';
import { getRuntime, tryGetRuntime } from './locator';
import { LazyClient } from './lazyClient';
import { SDK_VERSION } from './version';

function meta(): ClientMeta {
  return { sdkVersion: SDK_VERSION, abi: ABI };
}

/**
 * Create a local client.
 *
 * Pass the registry's generated `TopicContracts` as the third type
 * parameter to make the verbs kind-aware:
 * `createClient<Topic, TopicPayloads, TopicContracts>('cart')`.
 *
 * With a runtime present the client is created immediately and
 * `CLIENT_ID_TAKEN` is thrown for a duplicate id (unless
 * `options.onConflict === 'reset'`). Without one, a lazy proxy is returned:
 * `on()` records the subscription, `emit()` / `request()` queue (bounded,
 * default 64; overflow resolves the oldest with `NACK RUNTIME_NOT_READY`),
 * and everything flushes in order once the host calls `initBroker()`. A
 * runtime that is too old for this SDK never throws from here — a module
 * must load even on a stale host — the proxy stays blocked instead: every
 * `emit()` / `request()` answers `NACK RUNTIME_TOO_OLD`, `on()` records
 * nothing, and the reason is logged once. `whenRuntimeReady()` rejects with
 * the same error for code that wants to handle it.
 *
 * @example
 * import type { Topic, TopicPayloads } from '@my-org/topics';
 * export const bus = createClient<Topic, TopicPayloads>('cart');
 */
export function createClient<
  T extends string = string,
  P extends Record<T, any> = any,
  C extends TopicContractsMap<T> = TopicContractsMap<T>,
>(id: string, options?: ClientOptions): Client<T, P, C> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('@hedwigjs/client: client id must be a non-empty string');
  }
  const runtime = tryGetRuntime();
  if (runtime) {
    return runtime.createClient(id, options, meta()) as Client<T, P, C>;
  }
  // No runtime yet, or one that is too old: the lazy proxy binds when a
  // usable runtime appears, or blocks itself (RUNTIME_TOO_OLD) — see LazyClient.
  return new LazyClient<T, P, C>(id, options, meta());
}

/**
 * Register a participant that lives on the far side of a transport.
 *
 * Not proxied: a transport needs a live runtime. Throws
 * `RUNTIME_NOT_PROVIDED` when none exists — `await whenRuntimeReady()`
 * first — and `TRANSPORT_UNSUPPORTED` for a descriptor `kind` the runtime
 * does not provide (`hasCapability('transport.<kind>')` tells ahead).
 *
 * @example
 * const backend = createRemoteClient('notifications-backend', {
 *   transport: { kind: 'websocket', socket },
 *   accepts: ['notification.*'],
 * });
 */
export function createRemoteClient(id: string, options: RemoteClientOptions): RemoteClient {
  return getRuntime().createRemoteClient(id, options, meta());
}
