import { readHandle, RUNTIME_READY_EVENT, ABI } from './handle';
import type { RuntimeHandle } from './handle';
import { HedwigSdkError } from './errors';
import { MIN_RUNTIME, SDK_VERSION, compareVersions } from './version';

/**
 * Two gates: no handle → `RUNTIME_NOT_PROVIDED`; a handle whose
 * `runtimeVersion` is below this SDK's `MIN_RUNTIME` → `RUNTIME_TOO_OLD`.
 */
export function getRuntime(): RuntimeHandle {
  const handle = readHandle();
  if (!handle) {
    throw new HedwigSdkError(
      'RUNTIME_NOT_PROVIDED',
      `@hedwigjs/client: no Hedwig runtime (ABI ${ABI}) in this realm. Call initBroker() in the host before mounting modules, or await whenRuntimeReady().`,
    );
  }
  if (compareVersions(handle.runtimeVersion, MIN_RUNTIME) < 0) {
    throw new HedwigSdkError(
      'RUNTIME_TOO_OLD',
      `@hedwigjs/client ${SDK_VERSION} needs a runtime ≥ ${MIN_RUNTIME}; this realm provides ${handle.runtimeVersion}. Update @hedwigjs/broker in the host.`,
    );
  }
  return handle;
}

/** The runtime if it is present and new enough; `undefined` otherwise. */
export function tryGetRuntime(): RuntimeHandle | undefined {
  const handle = readHandle();
  if (!handle || compareVersions(handle.runtimeVersion, MIN_RUNTIME) < 0) return undefined;
  return handle;
}

export interface RuntimeInfo {
  abi: number;
  runtimeVersion: string;
  capabilities: ReadonlySet<string>;
  sdkVersion: string;
  minRuntime: string;
}

/** What is known about the runtime in this realm, or `null` when none is usable. */
export function getRuntimeInfo(): RuntimeInfo | null {
  const handle = tryGetRuntime();
  if (!handle) return null;
  return {
    abi: handle.abi,
    runtimeVersion: handle.runtimeVersion,
    capabilities: handle.capabilities,
    sdkVersion: SDK_VERSION,
    minRuntime: MIN_RUNTIME,
  };
}

/**
 * Feature detection for optional runtime features, e.g.
 * `hasCapability('transport.message-port')`. `false` when no runtime is
 * present yet.
 */
export function hasCapability(name: string): boolean {
  return tryGetRuntime()?.capabilities.has(name) ?? false;
}

/**
 * Resolves with the runtime handle as soon as one is registered in this
 * realm — immediately when it already is. Listens for the
 * `hedwig:runtime-ready` event where `globalThis` is an `EventTarget`
 * and polls otherwise. Applies the same gates as {@link getRuntime}.
 */
export function whenRuntimeReady(): Promise<RuntimeHandle> {
  const now = readHandle();
  if (now) {
    // The gate may refuse the handle that is already there (RUNTIME_TOO_OLD);
    // a promise-returning function reports that as a rejection, never a throw.
    try {
      return Promise.resolve(getRuntime());
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise<RuntimeHandle>((resolve, reject) => {
    const settle = () => {
      try {
        resolve(getRuntime());
      } catch (error) {
        reject(error);
      }
    };
    const target = globalThis as unknown as Partial<EventTarget>;
    if (typeof target.addEventListener === 'function') {
      const onReady = () => {
        target.removeEventListener?.(RUNTIME_READY_EVENT, onReady);
        settle();
      };
      target.addEventListener(RUNTIME_READY_EVENT, onReady);
      return;
    }
    const timer = setInterval(() => {
      if (readHandle()) {
        clearInterval(timer);
        settle();
      }
    }, 50);
    unref(timer);
  });
}

/** A polling timer must never keep a Node process alive. */
function unref(timer: ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

/** @internal Subscribe to runtime registration; returns an unsubscribe. */
export function onRuntimeReady(callback: () => void): () => void {
  const target = globalThis as unknown as Partial<EventTarget>;
  if (typeof target.addEventListener === 'function') {
    target.addEventListener(RUNTIME_READY_EVENT, callback);
    return () => target.removeEventListener?.(RUNTIME_READY_EVENT, callback);
  }
  const timer = setInterval(() => {
    if (readHandle()) {
      clearInterval(timer);
      callback();
    }
  }, 50);
  unref(timer);
  return () => clearInterval(timer);
}
