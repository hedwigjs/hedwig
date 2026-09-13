import type { Client, ClientOptions } from './types/client';
import type { RemoteClient, RemoteClientOptions } from './types/remote';

/**
 * The contract between this SDK and a runtime living in the same realm.
 *
 * One symbol per ABI: a runtime that must break the contract registers a
 * second handle under `…/2` for a deprecation window while `…/1` keeps
 * serving older SDKs. Within an ABI the runtime only adds; optional
 * features are announced in `capabilities`.
 */
export const ABI = 1;

/** The `globalThis` key the runtime registers its handle under. */
export const RUNTIME_KEY: unique symbol = Symbol.for(`@hedwigjs/runtime/${ABI}`) as never;

/** Dispatched on `globalThis` (where it is an `EventTarget`) once a runtime registered. */
export const RUNTIME_READY_EVENT = 'hedwig:runtime-ready';

/** What the SDK tells the runtime about the caller. */
export interface ClientMeta {
  /** Version of `@hedwigjs/client` making the call. */
  sdkVersion: string;
  /** ABI the call came through. */
  abi: number;
}

export interface RuntimeHandle {
  /** This handle's ABI (matches the key). */
  readonly abi: number;
  /** npm version of the runtime package (`@hedwigjs/broker`). */
  readonly runtimeVersion: string;
  /** Stable feature strings: `transport.websocket`, `wire.v1`, `remote.requests`, … */
  readonly capabilities: ReadonlySet<string>;
  createClient(id: string, options: ClientOptions | undefined, meta: ClientMeta): Client<any, any, any>;
  createRemoteClient(id: string, options: RemoteClientOptions, meta: ClientMeta): RemoteClient;
}

/** The raw handle, if any — no gates applied. */
export function readHandle(): RuntimeHandle | undefined {
  return (globalThis as unknown as Record<symbol, RuntimeHandle | undefined>)[RUNTIME_KEY];
}
