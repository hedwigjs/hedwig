/**
 * @jest-environment jsdom
 */
import React, { StrictMode, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ABI, MIN_RUNTIME, RUNTIME_KEY, RUNTIME_READY_EVENT } from '@hedwigjs/client';
import type { Client, RuntimeHandle, RemoteClient, RoutingResult } from '@hedwigjs/client';
import { useClient, useRemoteClient, useRequest, useRuntimeReady, useStateTopic, useTopic } from './index';

/**
 * The hooks are tested against a fake runtime handle (the SDK's contract),
 * exactly like the SDK's own suite: what matters here is lifecycle binding,
 * not routing. Under React 19 `act` from 'react' and `createRoot`.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (m: { topic: string; data: unknown; replayed?: boolean }) => unknown;

class FakeClient {
  destroyed = false;
  handlers = new Map<string, Set<Handler>>();
  requests: Array<{ recipient: string; topic: string; data: unknown }> = [];
  answer: (topic: string, data: unknown) => RoutingResult<any> = (topic, data) => ({
    status: 'ACK',
    reason: 'DELIVERED',
    message: '',
    timestamp: 1,
    data: { echoed: data, topic },
  });
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
  async emit(topic: string, data: unknown) {
    this.retained.set(topic, data);
    for (const h of this.handlers.get(topic) ?? []) h({ topic, data });
    return { status: 'ACK', reason: 'DISPATCHED', message: '', timestamp: 1 } as RoutingResult;
  }
  async request(recipient: string, topic: string, data: unknown) {
    this.requests.push({ recipient, topic, data });
    return this.answer(topic, data);
  }
  reset() {}
  destroy() {
    this.destroyed = true;
    this.handlers.clear();
  }
  /** Test helper: deliver to subscribers of `topic`. */
  push(topic: string, data: unknown) {
    for (const h of this.handlers.get(topic) ?? []) h({ topic, data });
  }
}

const state = {
  clients: [] as FakeClient[],
  remotes: [] as Array<{ id: string; destroyed: boolean; options: unknown }>,
  retained: new Map<string, unknown>(),
};

function installHandle(): void {
  const handle: RuntimeHandle = {
    abi: ABI,
    runtimeVersion: MIN_RUNTIME,
    capabilities: new Set(['transport.websocket']),
    createClient: (id) => {
      const live = state.clients.find((c) => c.id === id && !c.destroyed);
      if (live) throw Object.assign(new Error(`taken: ${id}`), { code: 'CLIENT_ID_TAKEN' });
      const c = new FakeClient(id, state.retained);
      state.clients.push(c);
      return c as unknown as Client<any, any, any>;
    },
    createRemoteClient: (id, options) => {
      const r = { id, destroyed: false, options, destroy() { r.destroyed = true; } };
      state.remotes.push(r);
      return r as unknown as RemoteClient;
    },
  };
  Object.defineProperty(globalThis, RUNTIME_KEY, { value: handle, configurable: true, enumerable: false, writable: false });
  // jsdom's globalThis is an EventTarget, so the SDK waits for the event the
  // runtime dispatches on registration instead of polling.
  globalThis.dispatchEvent(new Event(RUNTIME_READY_EVENT));
}

function removeHandle(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[RUNTIME_KEY];
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  state.clients = [];
  state.remotes = [];
  state.retained = new Map();
  installHandle();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  removeHandle();
});

const live = () => state.clients.filter((c) => !c.destroyed);

describe('useClient', () => {
  function Probe({ id }: { id: string }) {
    const client = useClient(id);
    return <span data-testid="id">{client ? client.id : 'none'}</span>;
  }

  test('creates the client before paint and destroys it on unmount', () => {
    act(() => root.render(<Probe id="cart" />));
    expect(container.textContent).toBe('cart');
    expect(live().map((c) => c.id)).toEqual(['cart']);

    act(() => root.unmount());
    expect(live()).toHaveLength(0);
    root = createRoot(container);
  });

  test('StrictMode double-mount leaves exactly one live client', () => {
    act(() =>
      root.render(
        <StrictMode>
          <Probe id="strict" />
        </StrictMode>,
      ),
    );
    expect(container.textContent).toBe('strict');
    expect(live().map((c) => c.id)).toEqual(['strict']);
    expect(state.clients.length).toBeGreaterThanOrEqual(2); // the first one was destroyed by StrictMode's cleanup
  });

  test('a new id recreates the client', () => {
    act(() => root.render(<Probe id="a" />));
    act(() => root.render(<Probe id="b" />));
    expect(live().map((c) => c.id)).toEqual(['b']);
  });
});

describe('useStateTopic / useTopic', () => {
  function Cart() {
    const client = useClient<'cart.snapshot.v1', { 'cart.snapshot.v1': { items: number } }>('cart-ui');
    const snapshot = useStateTopic(client, 'cart.snapshot.v1', { items: 0 });
    return <span>{`items:${snapshot.items}`}</span>;
  }

  test('the retained value is shown on the first paint and live updates follow', () => {
    state.retained.set('cart.snapshot.v1', { items: 2 });
    act(() => root.render(<Cart />));
    expect(container.textContent).toBe('items:2');

    act(() => live()[0]!.push('cart.snapshot.v1', { items: 5 }));
    expect(container.textContent).toBe('items:5');
  });

  test('useTopic always calls the latest handler and unsubscribes on unmount', () => {
    const seen: string[] = [];
    function Listener({ label }: { label: string }) {
      const client = useClient<'t.v1', { 't.v1': number }>('listener');
      useTopic(client, 't.v1', (m) => void seen.push(`${label}:${m.data}`));
      return null;
    }
    act(() => root.render(<Listener label="first" />));
    act(() => live()[0]!.push('t.v1', 1));
    act(() => root.render(<Listener label="second" />));
    act(() => live()[0]!.push('t.v1', 2));
    expect(seen).toEqual(['first:1', 'second:2']);
    expect(live()[0]!.handlers.get('t.v1')?.size).toBe(1);

    act(() => root.unmount());
    root = createRoot(container);
    expect(live()).toHaveLength(0);
  });
});

describe('useRequest', () => {
  type T = 'status.v1';
  type P = { 'status.v1': { includeLang: boolean } };
  type C = { 'status.v1': { kind: 'request'; response: { echoed: { includeLang: boolean } } } };

  function Asker() {
    const client = useClient<T, P, C>('asker');
    const status = useRequest(client, 'backend', 'status.v1');
    return (
      <button onClick={() => void status.send({ includeLang: true })} disabled={status.pending}>
        {status.pending ? 'pending' : status.result ? `${status.result.status}:${status.result.data?.echoed.includeLang}` : 'idle'}
      </button>
    );
  }

  test('send() flips pending, stores the typed result, and reaches the client', async () => {
    act(() => root.render(<Asker />));
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('idle');

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(button.textContent).toBe('ACK:true');
    expect(live()[0]!.requests).toEqual([{ recipient: 'backend', topic: 'status.v1', data: { includeLang: true } }]);
  });

  test('a send before the client exists resolves NACK RUNTIME_NOT_READY without throwing', async () => {
    let handle: ReturnType<typeof useRequest> | null = null;
    function Early() {
      handle = useRequest(null, 'backend', 'status.v1');
      return null;
    }
    act(() => root.render(<Early />));
    const result = await handle!.send({ includeLang: false });
    expect(result).toMatchObject({ status: 'NACK', reason: 'RUNTIME_NOT_READY' });
  });
});

describe('useRemoteClient', () => {
  function Frame({ win }: { win: object | null }) {
    const remote = useRemoteClient('checkout-iframe', win ? { transport: { kind: 'websocket', socket: win as never } } : null, [win]);
    return <span>{remote ? remote.id : 'none'}</span>;
  }

  test('created when options appear, recreated when deps change, destroyed on unmount', () => {
    act(() => root.render(<Frame win={null} />));
    expect(container.textContent).toBe('none');
    expect(state.remotes).toHaveLength(0);

    const first = {};
    act(() => root.render(<Frame win={first} />));
    expect(container.textContent).toBe('checkout-iframe');
    expect(state.remotes).toHaveLength(1);

    const second = {};
    act(() => root.render(<Frame win={second} />));
    expect(state.remotes).toHaveLength(2);
    expect(state.remotes[0]!.destroyed).toBe(true);
    expect(state.remotes[1]!.destroyed).toBe(false);

    act(() => root.render(<Frame win={null} />));
    expect(state.remotes[1]!.destroyed).toBe(true);
    expect(container.textContent).toBe('none');
  });
});

describe('useRuntimeReady', () => {
  test('reports the runtime once it is there', async () => {
    removeHandle();
    let latest = false;
    function Probe() {
      latest = useRuntimeReady();
      return null;
    }
    act(() => root.render(<Probe />));
    expect(latest).toBe(false);
    installHandle();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(latest).toBe(true);
  });
});

test('hooks accept a module-scope client too (useState-owned here for the test)', () => {
  function Consumer() {
    const [client] = useState(() => (globalThis as any)[RUNTIME_KEY].createClient('module-scope', undefined, { sdkVersion: 'x', abi: 1 }) as Client<any, any, any>);
    const value = useStateTopic(client, 'cart.snapshot.v1', { items: -1 });
    return <span>{`items:${(value as { items: number }).items}`}</span>;
  }
  state.retained.set('cart.snapshot.v1', { items: 9 });
  act(() => root.render(<Consumer />));
  expect(container.textContent).toBe('items:9');
});
