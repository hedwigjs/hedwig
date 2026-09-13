import type { Client, ClientOptions } from './types/client';
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
 * With a runtime present the client is created immediately and
 * `CLIENT_ID_TAKEN` is thrown for a duplicate id (unless
 * `options.onConflict === 'reset'`). Without one, a lazy proxy is returned:
 * `on()` records the subscription, `emit()` / `request()` queue (bounded,
 * default 64; overflow resolves the oldest with `NACK RUNTIME_NOT_READY`),
 * and everything flushes in order once the host calls `initBroker()`. A
 * runtime that is too old for this SDK throws `RUNTIME_TOO_OLD` at bind.
 *
 * @example
 * import type { Topic, TopicPayloads } from '@my-org/topics';
 * export const bus = createClient<Topic, TopicPayloads>('cart');
 */
export function createClient<T extends string = string, P extends Record<T, any> = any>(
  id: string,
  options?: ClientOptions,
): Client<T, P> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('@hedwigjs/client: client id must be a non-empty string');
  }
  const runtime = tryGetRuntime();
  if (runtime) {
    return runtime.createClient(id, options, meta()) as Client<T, P>;
  }
  // No runtime, or one that is too old: the lazy proxy binds later and the
  // version gate fires then, so a too-old runtime still surfaces as an error.
  getRuntimeGateOrDefer();
  return new LazyClient<T, P>(id, options, meta());
}

/** Throws `RUNTIME_TOO_OLD` now if a runtime exists but is too old; silent when none exists. */
function getRuntimeGateOrDefer(): void {
  try {
    getRuntime();
  } catch (error) {
    if ((error as { code?: string }).code === 'RUNTIME_TOO_OLD') throw error;
  }
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
