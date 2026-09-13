import {
  createClient,
  createRemoteClient,
  getRuntime,
  getRuntimeInfo,
  hasCapability,
  whenRuntimeReady,
  RUNTIME_KEY,
  RUNTIME_READY_EVENT,
  LazyClient,
  MIN_RUNTIME,
  SDK_VERSION,
  ABI,
} from './index';
import type { RuntimeHandle, Client } from './index';

/**
 * The SDK is tested against a fake handle: it depends on nothing at
 * runtime, so nothing but the handle contract is needed here. The
 * integration with the real runtime lives in the broker package.
 */

function installHandle(overrides: Partial<RuntimeHandle> = {}): { handle: RuntimeHandle; clients: Map<string, FakeClient> } {
  const clients = new Map<string, FakeClient>();
  const handle: RuntimeHandle = {
    abi: ABI,
    runtimeVersion: MIN_RUNTIME,
    capabilities: new Set(['transport.websocket', 'wire.v1']),
    createClient: jest.fn((id: string, options, meta) => {
      const c = new FakeClient(id, meta.sdkVersion);
      clients.set(id, c);
      return c as unknown as Client<any, any>;
    }),
    createRemoteClient: jest.fn((id: string) => ({ id }) as never),
    ...overrides,
  };
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: handle, configurable: true, enumerable: false, writable: false });
  (globalThis as unknown as EventTarget).dispatchEvent?.(new Event(RUNTIME_READY_EVENT));
  return { handle, clients };
}

function removeHandle(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[RUNTIME_KEY];
}

class FakeClient {
  calls: string[] = [];
  handlers = new Map<string, unknown[]>();
  constructor(
    readonly id: string,
    readonly sdkVersion: string,
  ) {}
  on(topic: string, handler: unknown) {
    this.calls.push(`on:${topic}`);
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
    return () => {
      this.calls.push(`off:${topic}`);
      this.handlers.set(topic, (this.handlers.get(topic) ?? []).filter((h) => h !== handler));
    };
  }
  off(topic: string) {
    this.calls.push(`off:${topic}`);
  }
  async emit(topic: string, data: unknown) {
    this.calls.push(`emit:${topic}:${JSON.stringify(data)}`);
    return { status: 'ACK', reason: 'DISPATCHED', message: '', timestamp: 1 };
  }
  async request(to: string, topic: string, data: unknown) {
    this.calls.push(`request:${to}:${topic}:${JSON.stringify(data)}`);
    return { status: 'ACK', reason: 'DELIVERED', message: '', timestamp: 1, data: { echoed: data } };
  }
  reset() {
    this.calls.push('reset');
  }
  destroy() {
    this.calls.push('destroy');
  }
}

afterEach(removeHandle);

describe('locator gates', () => {
  test('no handle → RUNTIME_NOT_PROVIDED with an actionable message', () => {
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_NOT_PROVIDED' }));
    expect(() => getRuntime()).toThrow(/initBroker\(\)/);
    expect(getRuntimeInfo()).toBeNull();
    expect(hasCapability('transport.websocket')).toBe(false);
  });

  test('handle below MIN_RUNTIME → RUNTIME_TOO_OLD: getRuntime throws, whenRuntimeReady rejects, createClient degrades', async () => {
    installHandle({ runtimeVersion: '0.0.1' });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_TOO_OLD' }));
    expect(getRuntimeInfo()).toBeNull();
    // A promise-returning function reports the gate as a rejection, not a throw.
    await expect(whenRuntimeReady()).rejects.toMatchObject({ code: 'RUNTIME_TOO_OLD' });

    // A module must load on a stale host: no throw at module scope, a blocked client instead.
    const c = createClient<'a.v1', { 'a.v1': number }>('x');
    expect(c).toBeInstanceOf(LazyClient);
    expect((c as LazyClient<any, any>).blocked).toMatchObject({ code: 'RUNTIME_TOO_OLD' });
    const off = c.on('a.v1', jest.fn());
    expect(typeof off).toBe('function');
    await expect(c.emit('a.v1', 1)).resolves.toMatchObject({ status: 'NACK', reason: 'RUNTIME_TOO_OLD' });
    await expect(c.request('y', 'a.v1', 1)).resolves.toMatchObject({ status: 'NACK', reason: 'RUNTIME_TOO_OLD' });
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  test('a lazy client that waits for a runtime and gets a too-old one blocks itself and settles its queue', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const c = createClient<'a.v1', { 'a.v1': number }>('late');
    const pending = c.emit('a.v1', 1);
    installHandle({ runtimeVersion: '0.0.1' });
    await new Promise((r) => setTimeout(r, 80)); // polling interval in Node
    await expect(pending).resolves.toMatchObject({ status: 'NACK', reason: 'RUNTIME_TOO_OLD' });
    expect((c as LazyClient<any, any>).blocked).not.toBeNull();
    expect((c as LazyClient<any, any>).queued).toBe(0);
    errorLog.mockRestore();
  });

  test('a usable handle reports info and capabilities', () => {
    installHandle({ runtimeVersion: '9.9.9' });
    expect(getRuntimeInfo()).toEqual({
      abi: ABI,
      runtimeVersion: '9.9.9',
      capabilities: new Set(['transport.websocket', 'wire.v1']),
      sdkVersion: SDK_VERSION,
      minRuntime: MIN_RUNTIME,
    });
    expect(hasCapability('transport.websocket')).toBe(true);
    expect(hasCapability('transport.carrier-pigeon')).toBe(false);
  });

  test('whenRuntimeReady resolves immediately with a handle, and on the ready event without one', async () => {
    installHandle();
    await expect(whenRuntimeReady()).resolves.toMatchObject({ abi: ABI });
    removeHandle();

    const pending = whenRuntimeReady();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    installHandle();
    await expect(pending).resolves.toMatchObject({ abi: ABI });
  });
});

describe('createClient', () => {
  test('with a runtime: created through the handle with the SDK meta', () => {
    const { handle, clients } = installHandle();
    const c = createClient('cart', { onConflict: 'reset' });
    expect(handle.createClient).toHaveBeenCalledWith('cart', { onConflict: 'reset' }, { sdkVersion: SDK_VERSION, abi: ABI });
    expect(c).toBe(clients.get('cart'));
    expect(c).not.toBeInstanceOf(LazyClient);
  });

  test('without a runtime: a lazy proxy records subscriptions and queues calls, then flushes in order', async () => {
    const c = createClient<'a.v1' | 'b.v1', { 'a.v1': number; 'b.v1': number }>('cart');
    expect(c).toBeInstanceOf(LazyClient);
    const lazy = c as LazyClient<any, any>;

    const handler = jest.fn();
    const offA = c.on('a.v1', handler);
    c.on('b.v1', handler);
    offA();
    const emitted = c.emit('a.v1', 1);
    const requested = c.request<'b.v1', { echoed: number }>('menu', 'b.v1', 2);
    expect(lazy.bound).toBe(false);
    expect(lazy.queued).toBe(2);

    const { clients } = installHandle();
    // Node's globalThis is not an EventTarget: the SDK polls every 50 ms.
    await new Promise((r) => setTimeout(r, 80));

    expect(lazy.bound).toBe(true);
    expect(lazy.queued).toBe(0);
    const real = clients.get('cart')!;
    expect(real.sdkVersion).toBe(SDK_VERSION);
    // The removed subscription is never replayed; the rest in order.
    expect(real.calls).toEqual(['on:b.v1', 'emit:a.v1:1', 'request:menu:b.v1:2']);
    await expect(emitted).resolves.toMatchObject({ status: 'ACK', reason: 'DISPATCHED' });
    await expect(requested).resolves.toMatchObject({ status: 'ACK', data: { echoed: 2 } });

    // After binding, calls go straight through.
    c.off('b.v1');
    await c.emit('b.v1', 3);
    expect(real.calls.slice(-2)).toEqual(['off:b.v1', 'emit:b.v1:3']);
    c.destroy();
    expect(real.calls.at(-1)).toBe('destroy');
  });

  test('binding is isolated per subscription: a rejected one does not stop the others or the queue', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const c = createClient<'denied.v1' | 'ok.v1', { 'denied.v1': number; 'ok.v1': number }>('guarded');
    c.on('denied.v1', jest.fn());
    c.on('ok.v1', jest.fn());
    const emitted = c.emit('ok.v1', 7);

    const { clients } = installHandle({
      createClient: (id, _options, meta) => {
        const real = new FakeClient(id, meta.sdkVersion);
        const on = real.on.bind(real);
        real.on = (topic: string, handler: unknown) => {
          if (topic === 'denied.v1') throw new Error('ACL: denied.v1 is not for you');
          return on(topic, handler);
        };
        clients.set(id, real);
        return real as never;
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const real = clients.get('guarded')!;
    expect(real.calls).toEqual(['on:ok.v1', 'emit:ok.v1:7']);
    await expect(emitted).resolves.toMatchObject({ status: 'ACK' });
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]![0])).toContain("'denied.v1'");
    errorLog.mockRestore();
  });

  test('on() with a wildcard throws before any runtime exists, same as the runtime would', () => {
    const c = createClient<'a.*' | 'a.v1', { 'a.*': number; 'a.v1': number }>('strict');
    expect(() => c.on('a.*', jest.fn())).toThrow(TypeError);
    expect(() => c.on('a.v1', jest.fn())).not.toThrow();
    c.destroy(); // stop polling for a runtime — later tests install one
  });

  test('the queue is bounded: the oldest call is dropped with NACK RUNTIME_NOT_READY', async () => {
    const lazy = new LazyClient<string, Record<string, unknown>>('q', undefined, { sdkVersion: 'x', abi: ABI }, 2);
    const first = lazy.emit('t.1', 1);
    lazy.emit('t.2', 2);
    lazy.emit('t.3', 3);
    await expect(first).resolves.toMatchObject({ status: 'NACK', reason: 'RUNTIME_NOT_READY' });
    expect(lazy.queued).toBe(2);
    lazy.destroy();
  });

  test('destroying a lazy client before a runtime settles queued calls and never binds', async () => {
    const c = createClient('gone');
    const p = c.emit('t.1', 1);
    c.destroy();
    await expect(p).resolves.toMatchObject({ status: 'NACK', reason: 'RUNTIME_NOT_READY' });
    const { handle } = installHandle();
    await new Promise((r) => setTimeout(r, 80));
    expect(handle.createClient).not.toHaveBeenCalled();
  });

  test('an empty id is a TypeError', () => {
    expect(() => createClient('')).toThrow(TypeError);
  });
});

describe('createRemoteClient', () => {
  test('is not proxied: RUNTIME_NOT_PROVIDED without a runtime, forwarded with meta otherwise', () => {
    expect(() => createRemoteClient('backend', { transport: { kind: 'sse', url: '/x' } })).toThrow(
      expect.objectContaining({ code: 'RUNTIME_NOT_PROVIDED' }),
    );
    const { handle } = installHandle();
    createRemoteClient('backend', { transport: { kind: 'sse', url: '/x' } });
    expect(handle.createRemoteClient).toHaveBeenCalledWith(
      'backend',
      { transport: { kind: 'sse', url: '/x' } },
      { sdkVersion: SDK_VERSION, abi: ABI },
    );
  });
});
