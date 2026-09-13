import {
  createClient as sdkCreateClient,
  createRemoteClient as sdkCreateRemoteClient,
  getRuntimeInfo,
  hasCapability,
  whenRuntimeReady,
  readHandle,
  LazyClient,
  SDK_VERSION,
  ABI,
} from '@hedwigjs/client';
import { initBroker, destroyBroker, createClient, getBroker, VERSION } from './index';

/**
 * The SDK against the real runtime: the handle the facade registers, the
 * gates, the lazy proxy flushing into a real client, conflicts, and
 * teardown. The SDK's own suite covers the same contract with a fake.
 */

afterEach(() => {
  destroyBroker();
});

describe('runtime handle', () => {
  test('initBroker registers the ABI-1 handle; destroyBroker removes it', () => {
    expect(readHandle()).toBeUndefined();
    initBroker();
    const handle = readHandle()!;
    expect(handle).toMatchObject({ abi: ABI, runtimeVersion: VERSION });
    expect(handle.capabilities.has('transport.websocket')).toBe(true);
    expect(handle.capabilities.has('wire.v1')).toBe(true);
    expect(handle.capabilities.has('remote.requests')).toBe(true);
    expect(Object.keys(globalThis)).not.toContain(String(ABI));
    destroyBroker();
    expect(readHandle()).toBeUndefined();
  });

  test('a foreign handle in the realm makes initBroker throw RUNTIME_ALREADY_PROVIDED', () => {
    const key = Symbol.for(`@hedwigjs/runtime/${ABI}`);
    Object.defineProperty(globalThis, key, { value: { abi: ABI, runtimeVersion: '9.9.9' }, configurable: true });
    try {
      expect(() => initBroker()).toThrow(expect.objectContaining({ code: 'RUNTIME_ALREADY_PROVIDED' }));
    } finally {
      delete (globalThis as unknown as Record<symbol, unknown>)[key];
    }
  });

  test('getRuntimeInfo / hasCapability / whenRuntimeReady see the runtime', async () => {
    expect(getRuntimeInfo()).toBeNull();
    const ready = whenRuntimeReady();
    initBroker();
    await expect(ready).resolves.toMatchObject({ runtimeVersion: VERSION });
    expect(getRuntimeInfo()).toMatchObject({ abi: ABI, runtimeVersion: VERSION, sdkVersion: SDK_VERSION });
    expect(hasCapability('transport.message-port')).toBe(true);
  });
});

describe('SDK clients on the real runtime', () => {
  test('createClient with a runtime returns a real client carrying the SDK meta', async () => {
    initBroker();
    const a = sdkCreateClient<'t.v1', { 't.v1': number }>('a');
    const b = sdkCreateClient<'t.v1', { 't.v1': number }>('b');
    expect(a).not.toBeInstanceOf(LazyClient);
    const seen: number[] = [];
    b.on('t.v1', (m) => {
      seen.push(m.data);
    });
    const result = await a.emit('t.v1', 7);
    expect(result).toMatchObject({ status: 'ACK', reason: 'DISPATCHED' });
    expect(seen).toEqual([7]);
    expect(getBroker().inspect.getClients().find((c) => c.id === 'a')?.sdkVersion).toBe(SDK_VERSION);
  });

  test('a lazy client created before initBroker flushes into the runtime in order', async () => {
    const early = sdkCreateClient<'t.v1' | 'u.v1', { 't.v1': number; 'u.v1': number }>('early');
    expect(early).toBeInstanceOf(LazyClient);
    const seen: string[] = [];
    early.on('u.v1', (m) => {
      seen.push(`u:${m.data}`);
    });
    const emitted = early.emit('t.v1', 1);
    const requested = early.request('late', 'u.v1', 2);

    initBroker();
    const late = createClient<'t.v1' | 'u.v1', { 't.v1': number; 'u.v1': number }>('late');
    late.on('u.v1', (m) => `answered ${m.data}`);
    await new Promise((r) => setTimeout(r, 80));

    expect((early as LazyClient<any, any>).bound).toBe(true);
    // The emit went out before `late` subscribed to anything on t.v1 → NO_SUBSCRIBERS is the honest answer.
    await expect(emitted).resolves.toMatchObject({ status: 'NACK', reason: 'NO_SUBSCRIBERS' });
    await expect(requested).resolves.toMatchObject({ status: 'ACK', reason: 'DELIVERED', data: 'answered 2' });
    await late.emit('u.v1', 3);
    expect(seen).toEqual(['u:3']);
    expect(getBroker().inspect.getClients().find((c) => c.id === 'early')?.sdkVersion).toBe(SDK_VERSION);
  });

  test('duplicate ids throw CLIENT_ID_TAKEN unless onConflict: reset; a remote id is never reusable', () => {
    initBroker();
    sdkCreateClient('dup');
    expect(() => sdkCreateClient('dup')).toThrow(expect.objectContaining({ code: 'CLIENT_ID_TAKEN' }));
    expect(() => createClient('dup')).toThrow(expect.objectContaining({ code: 'CLIENT_ID_TAKEN' }));
    const again = sdkCreateClient('dup', { onConflict: 'reset' });
    expect(again.id).toBe('dup');

    const transport = { send: jest.fn(), onMessage: jest.fn(() => () => {}), destroy: jest.fn() };
    sdkCreateRemoteClient('backend', { transport });
    expect(() => sdkCreateClient('backend', { onConflict: 'reset' })).toThrow(expect.objectContaining({ code: 'CLIENT_ID_TAKEN' }));
    expect(() => sdkCreateRemoteClient('dup', { transport })).toThrow(/already taken/);
  });

  test('createRemoteClient through the SDK registers a remote on the runtime', () => {
    initBroker();
    const transport = { send: jest.fn(), onMessage: jest.fn(() => () => {}), destroy: jest.fn() };
    const remote = sdkCreateRemoteClient('backend', { transport, accepts: ['t.*'] });
    expect(remote.kind).toBe('custom');
    expect(getBroker().getRemoteClient('backend')).toBe(remote);
    expect(() => sdkCreateRemoteClient('nope', { transport: { kind: 'pigeon' } as never })).toThrow(/unsupported transport kind/);
  });
});
