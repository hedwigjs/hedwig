/**
 * @hedwigjs/client
 *
 * The SDK a module uses to talk to the Hedwig runtime the host booted.
 * Depends on nothing at runtime: it finds the runtime through a handle on
 * `globalThis` (one symbol per ABI), checks that the runtime is new enough
 * for these types, and hands out clients.
 *
 *   - `createClient(id)` — a local participant; works before the runtime
 *     exists (lazy proxy, flushed in order on `initBroker()`).
 *   - `createRemoteClient(id, { transport, … })` — a participant behind a
 *     wire; needs a live runtime.
 *   - `whenRuntimeReady()`, `hasCapability()`, `getRuntimeInfo()`.
 *
 * Every type a module can see is exported from here; the runtime package
 * re-exports the same types for host code.
 */

export { createClient, createRemoteClient } from './createClient';
export { getRuntime, tryGetRuntime, getRuntimeInfo, hasCapability, whenRuntimeReady } from './locator';
export type { RuntimeInfo } from './locator';
export { ABI, RUNTIME_KEY, RUNTIME_READY_EVENT, readHandle } from './handle';
export type { RuntimeHandle, ClientMeta } from './handle';
export { HedwigSdkError } from './errors';
export type { SdkErrorCode } from './errors';
export { SDK_VERSION, MIN_RUNTIME, compareVersions } from './version';
export { LazyClient, DEFAULT_QUEUE_LIMIT } from './lazyClient';

export { RoutingReason } from './types/routing';
export type { RoutingReasonType, RoutingResult } from './types/routing';
export type {
  ClientID,
  Message,
  HandlerFn,
  MessageOptions,
  RequestOptions,
  ReplayOptions,
  BackpressureOptions,
  SubscriptionOptions,
} from './types/message';
export type { Client, ClientOptions } from './types/client';
export type { Transport, TransportDescriptor, TransportKind } from './types/transport';
export type {
  RemoteClient,
  RemoteClientOptions,
  RemoteIdentity,
  RemoteFrameRejectReason,
} from './types/remote';
