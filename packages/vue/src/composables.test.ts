/**
 * @jest-environment jsdom
 */
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { ABI, MIN_RUNTIME, RUNTIME_KEY, RUNTIME_READY_EVENT } from '@hedwigjs/client';
import type { Client, RemoteClient, RoutingResult, RuntimeHandle } from '@hedwigjs/client';
import { bindComposables, useClient, useRemoteClient, useRequest, useRuntimeReady, useStateTopic, useTopic } from './index';

type Handler = (m: { topic: string; data: unknown; replayed?: boolean }) => unknown;

class FakeClient {
  destroyed = false;
  handlers = new Map<string, Set<Handler>>();
  requests: Array<{ recipient: string; topic: string; data: unknown }> = [];
  constructor(
    readonly id: string,
    private readonly retained: Map<string, unknown>,
  ) {}
  on(topic: string, handler: Handler) {
    const set = this.handlers.get(topic) ?? new Set();
    set.add(handler);
    this.handlers.set(topic, set);
    if (this.retained.has(topic)) handler({ topic, data: this.retained.get(topic), replayed: true });
    return () => {
      set.delete(handler);
    };
  }
  off(topic: string) {
    this.handlers.delete(topic);
  }
  async emit() {
    return { status: 'ACK', reason: 'DISPATCHED', message: '', timestamp: 1 } as RoutingResult;
  }
  async request(recipient: string, topic: string, data: unknown) {
    this.requests.push({ recipient, topic, data });
    return { status: 'ACK', reason: 'DELIVERED', message: '', timestamp: 1, data: { echoed: data } } as RoutingResult<any>;
  }
  reset() {}
  destroy() {
    this.destroyed = true;
    this.handlers.clear();
  }
  push(topic: string, data: unknown) {
    for (const h of this.handlers.get(topic) ?? []) h({ topic, data });
  }
}

const state = {
  clients: [] as FakeClient[],
  remotes: [] as Array<{ id: string; destroyed: boolean }>,
  retained: new Map<string, unknown>(),
};

function installHandle(): void {
  const handle: RuntimeHandle = {
    abi: ABI,
    runtimeVersion: MIN_RUNTIME,
    capabilities: new Set(),
    createClient: (id) => {
      const c = new FakeClient(id, state.retained);
      state.clients.push(c);
      return c as unknown as Client<any, any, any>;
    },
    createRemoteClient: (id) => {
      const r = { id, destroyed: false, destroy() { r.destroyed = true; } };
      state.remotes.push(r);
      return r as unknown as RemoteClient;
    },
  };
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: handle, configurable: true, enumerable: false, writable: false });
  globalThis.dispatchEvent(new Event(RUNTIME_READY_EVENT));
}
function removeHandle(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[RUNTIME_KEY];
}

let app: App | null = null;
function mount(setup: () => unknown): void {
  app = createApp(defineComponent({ setup, render: () => h('div') }));
  app.mount(document.createElement('div'));
}

beforeEach(() => {
  state.clients = [];
  state.remotes = [];
  state.retained = new Map();
  installHandle();
});
afterEach(() => {
  app?.unmount();
  app = null;
  removeHandle();
});

const live = () => state.clients.filter((c) => !c.destroyed);

test('useClient creates in setup and destroys on unmount', () => {
  let id = '';
  mount(() => {
    id = useClient('cart').id;
  });
  expect(id).toBe('cart');
  expect(live()).toHaveLength(1);
  app!.unmount();
  app = null;
  expect(live()).toHaveLength(0);
});

test('useStateTopic holds the retained value immediately and follows live updates', async () => {
  state.retained.set('cart.snapshot.v1', { items: 2 });
  let value: { items: number } | undefined;
  let snapshotRef: { value: { items: number } } | null = null;
  mount(() => {
    const client = useClient<'cart.snapshot.v1', { 'cart.snapshot.v1': { items: number } }>('cart-ui');
    snapshotRef = useStateTopic(client, 'cart.snapshot.v1', { items: 0 });
    value = snapshotRef.value;
  });
  expect(value).toEqual({ items: 2 });
  live()[0]!.push('cart.snapshot.v1', { items: 5 });
  await nextTick();
  expect(snapshotRef!.value).toEqual({ items: 5 });
});

test('useTopic follows a client ref and unsubscribes on dispose', async () => {
  const seen: number[] = [];
  mount(() => {
    const clientRef = ref<Client<'t.v1', { 't.v1': number }> | null>(null);
    useTopic(clientRef, 't.v1', (m) => void seen.push(m.data));
    clientRef.value = useClient<'t.v1', { 't.v1': number }>('late');
  });
  await nextTick();
  live()[0]!.push('t.v1', 1);
  expect(seen).toEqual([1]);
  app!.unmount();
  app = null;
  expect(live()).toHaveLength(0);
});

test('useRequest exposes pending / result refs and types the answer', async () => {
  type T = 'status.v1';
  type P = { 'status.v1': { includeLang: boolean } };
  type C = { 'status.v1': { kind: 'request'; response: { echoed: { includeLang: boolean } } } };
  let handle: ReturnType<typeof useRequest<T, P, C, 'status.v1'>> | null = null;
  mount(() => {
    const client = useClient<T, P, C>('asker');
    handle = useRequest(client, 'backend', 'status.v1');
  });
  const promise = handle!.send({ includeLang: true });
  expect(handle!.pending.value).toBe(true);
  const result = await promise;
  expect(result.data?.echoed.includeLang).toBe(true);
  expect(handle!.pending.value).toBe(false);
  expect(handle!.result.value?.status).toBe('ACK');
  expect(live()[0]!.requests).toEqual([{ recipient: 'backend', topic: 'status.v1', data: { includeLang: true } }]);
});

test('useRemoteClient follows a reactive options source', async () => {
  const win = ref<object | null>(null);
  let remote: { value: RemoteClient | null } | null = null;
  mount(() => {
    remote = useRemoteClient('checkout-iframe', () => (win.value ? { transport: { kind: 'websocket', socket: win.value as never } } : null));
  });
  expect(remote!.value).toBeNull();
  win.value = {};
  await nextTick();
  expect(remote!.value?.id).toBe('checkout-iframe');
  expect(state.remotes).toHaveLength(1);
  win.value = {};
  await nextTick();
  expect(state.remotes).toHaveLength(2);
  expect(state.remotes[0]!.destroyed).toBe(true);
  win.value = null;
  await nextTick();
  expect(state.remotes[1]!.destroyed).toBe(true);
  expect(remote!.value).toBeNull();
});

test('useRuntimeReady flips once the runtime appears', async () => {
  removeHandle();
  let ready: { value: boolean } | null = null;
  mount(() => {
    ready = useRuntimeReady();
  });
  expect(ready!.value).toBe(false);
  installHandle();
  await new Promise((r) => setTimeout(r, 80));
  expect(ready!.value).toBe(true);
});

test('bindComposables: composables bound to a module-scope client take no client argument', async () => {
  type T = 'cart.snapshot.v1' | 'status.v1';
  type P = { 'cart.snapshot.v1': { items: number }; 'status.v1': { includeLang: boolean } };
  type C = { 'status.v1': { kind: 'request'; response: { echoed: { includeLang: boolean } } } };
  state.retained.set('cart.snapshot.v1', { items: 2 });
  const bus = (globalThis as any)[RUNTIME_KEY].createClient('module-bus') as Client<T, P, C>;
  const { client, useStateTopic: useCartState, useRequest: useStatus } = bindComposables(bus);
  expect(client).toBe(bus);

  let snapshotRef: { value: { items: number } } | null = null;
  let status: ReturnType<typeof useStatus<'status.v1'>> | null = null;
  mount(() => {
    snapshotRef = useCartState('cart.snapshot.v1', { items: 0 });
    status = useStatus('backend', 'status.v1');
  });
  expect(snapshotRef!.value).toEqual({ items: 2 });
  live()[0]!.push('cart.snapshot.v1', { items: 5 });
  await nextTick();
  expect(snapshotRef!.value).toEqual({ items: 5 });

  const result = await status!.send({ includeLang: true });
  expect(result.data?.echoed.includeLang).toBe(true);
  expect(live()[0]!.requests).toEqual([{ recipient: 'backend', topic: 'status.v1', data: { includeLang: true } }]);

  app!.unmount();
  app = null;
  expect(live()).toHaveLength(1); // module-scope client is not owned by the scope
  expect(live()[0]!.handlers.get('cart.snapshot.v1')?.size ?? 0).toBe(0);
});
