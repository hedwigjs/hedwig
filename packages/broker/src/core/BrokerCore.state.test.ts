import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import type { BrokerLogger } from './logger/BrokerLogger.types';
import type { Message } from './types';

/**
 * `state` topics (RFC-0003 step 7): the runtime retains the last local
 * multicast per state topic and hands it to every new subscriber on `on()`,
 * flagged `replayed`, without any `history: true` at the emit site.
 */

type Topics = 'cart.snapshot.v1' | 'a.v1' | 'r.v1';
type Payloads = { 'cart.snapshot.v1': { items: number }; 'a.v1': { n: number }; 'r.v1': { q: string } };

function quietLogger(): BrokerLogger & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return { calls, warn: (e, m) => void calls.push([e, m]), error: (e, m) => void calls.push([e, m]) };
}

function setup(extra: Partial<ConstructorParameters<typeof BrokerCore<Topics, Payloads>>[0]> = {}) {
  const logger = quietLogger();
  const core = new BrokerCore<Topics, Payloads>({
    logger,
    topics: { 'cart.snapshot.v1': 'state', 'a.v1': 'event', 'r.v1': 'request' },
    ...extra,
  });
  const events: Array<[string, unknown]> = [];
  core.$systemEvents.onAny((n, p) => void events.push([n, p]));
  return { core, logger, events };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('state topics — retention', () => {
  test('the last multicast on a state topic is retained; a late subscriber gets it synchronously as replayed', async () => {
    const { core, events } = setup();
    const store = new BrokerClient('cart-store', core);
    await store.emit('cart.snapshot.v1', { items: 1 });
    await store.emit('cart.snapshot.v1', { items: 2 });

    expect(core.inspect.getRetained().map((r) => [r.topic, r.message.data])).toEqual([['cart.snapshot.v1', { items: 2 }]]);
    expect(events.filter(([n]) => n === 'state.retained')).toHaveLength(2);

    const seen: Message[] = [];
    const late = new BrokerClient('late', core);
    const afterSend = jest.fn();
    core.useAfterSendHook(afterSend);
    late.on('cart.snapshot.v1', (m) => void seen.push(m));

    // Synchronous: delivered before on() returned.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ data: { items: 2 }, replayed: true, source: 'cart-store' });
    expect(afterSend).toHaveBeenCalledTimes(1);
    expect(afterSend.mock.calls[0]![1]).toMatchObject({ status: 'ACK', reason: 'REPLAY_DELIVERED', recipientId: 'late' });
    core.destroy();
  });

  test('a subscriber that arrives before any emit gets nothing, then live updates; the emitter itself is excluded as usual', async () => {
    const { core } = setup();
    const seen: number[] = [];
    const ui = new BrokerClient('cart-ui', core);
    ui.on('cart.snapshot.v1', (m) => void seen.push(m.data.items));
    expect(seen).toEqual([]);

    const store = new BrokerClient('cart-store', core);
    const own: number[] = [];
    store.on('cart.snapshot.v1', (m) => void own.push(m.data.items));
    await store.emit('cart.snapshot.v1', { items: 3 });
    expect(seen).toEqual([3]);
    expect(own).toEqual([]);
    core.destroy();
  });

  test('retained: false opts out of the initial delivery', async () => {
    const { core } = setup();
    await new BrokerClient('cart-store', core).emit('cart.snapshot.v1', { items: 1 });
    const handler = jest.fn();
    new BrokerClient('live-only', core).on('cart.snapshot.v1', handler, { retained: false });
    expect(handler).not.toHaveBeenCalled();
    core.destroy();
  });

  test('event topics are not retained; unknown topics (no registry) are not retained either', async () => {
    const { core } = setup();
    await new BrokerClient('s', core).emit('a.v1', { n: 1 });
    const handler = jest.fn();
    new BrokerClient('late', core).on('a.v1', handler);
    expect(handler).not.toHaveBeenCalled();
    expect(core.inspect.getRetained()).toHaveLength(0);

    const bare = new BrokerCore<Topics, Payloads>({ logger: quietLogger() });
    await new BrokerClient('s', bare).emit('cart.snapshot.v1', { items: 1 });
    expect(bare.inspect.getRetained()).toHaveLength(0);
    bare.destroy();
    core.destroy();
  });

  test('a hook-rejected emit and an inbound frame from a remote are not retained', async () => {
    const { core } = setup();
    core.useBeforeSendHook((m) => (m.source === 'intruder' ? { allowed: false, message: 'no' } : { allowed: true }));
    await new BrokerClient('intruder', core).emit('cart.snapshot.v1', { items: 99 });
    expect(core.inspect.getRetained()).toHaveLength(0);

    let inbound: ((f: unknown) => void) | null = null;
    core.createRemoteClient('tabs', {
      transport: { send: jest.fn(), onMessage: (cb) => ((inbound = cb), () => {}), destroy: jest.fn() },
      identity: { mode: 'prefix' },
      accepts: ['cart.*'],
    });
    inbound!({ topic: 'cart.snapshot.v1', source: 'cart-store', target: '*', data: { items: 5 } });
    await tick();
    expect(core.inspect.getRetained()).toHaveLength(0);
    core.destroy();
  });

  test('with a replay option the history replay wins and the retained value is not delivered twice', async () => {
    const { core } = setup({ history: { enabled: true } });
    await new BrokerClient('cart-store', core).emit('cart.snapshot.v1', { items: 4 }, { history: true });
    const seen: Message[] = [];
    new BrokerClient('late', core).on('cart.snapshot.v1', (m) => void seen.push(m), { replay: { limit: 1 } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.data).toEqual({ items: 4 });
    core.destroy();
  });

  test('a throwing subscriber is isolated and logged; destroy() clears retained values', async () => {
    const { core, logger } = setup();
    await new BrokerClient('cart-store', core).emit('cart.snapshot.v1', { items: 1 });
    expect(() =>
      new BrokerClient('bad', core).on('cart.snapshot.v1', () => {
        throw new Error('boom');
      }),
    ).not.toThrow();
    expect(logger.calls.some(([e]) => e === 'replay.handler.failed')).toBe(true);
    core.destroy();
    expect(core.inspect.getRetained()).toHaveLength(0);
  });

  test('a request is never recorded to history', async () => {
    const { core } = setup({ history: { enabled: true } });
    const receiver = new BrokerClient('receiver', core);
    receiver.on('r.v1', () => 'ok');
    // The type no longer allows `history` on a request; a stray flag from
    // untyped code is ignored at runtime.
    await new BrokerClient('s', core).request('receiver', 'r.v1', { q: 'x' }, { history: true } as never);
    expect(core.inspect.getHistory()).toHaveLength(0);
    core.destroy();
  });
});
