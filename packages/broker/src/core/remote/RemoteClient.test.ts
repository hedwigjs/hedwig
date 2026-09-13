import { BrokerCore } from '../BrokerCore';
import { BrokerClient } from '../client/BrokerClient';
import { createTransport } from '../transport/createTransport';
import { MessagePortTransport } from '../../transports/MessagePortTransport';
import { SSETransport } from '../../transports/SSETransport';
import { BroadcastChannelTransport } from '../../transports/BroadcastChannelTransport';
import type { Transport } from '../transport/Transport.types';
import type { BrokerLogger } from '../logger/BrokerLogger.types';
import type { Message } from '../types';

/**
 * Remote clients (RFC-0003 rev 2, step 3a): a participant behind a
 * transport is a client with an identity this side controls, a set of
 * topics it may inject (`accepts`) and subscriptions it forwards.
 */

type Topics = 'a.v1' | 'b.v1' | 'cart.snapshot.v1';
type Payloads = {
  'a.v1': { n: number };
  'b.v1': { n: number };
  'cart.snapshot.v1': { items: number };
};

function quietLogger(): BrokerLogger & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    warn: (e, m) => {
      calls.push([e, m]);
    },
    error: (e, m) => {
      calls.push([e, m]);
    },
  };
}

interface FakeTransport extends Transport {
  send: jest.Mock;
  destroy: jest.Mock;
  fire(frame: unknown): void;
  close(): void;
}

function fakeTransport(flags: Partial<Pick<Transport, 'duplex' | 'fanout' | 'ready'>> = {}): FakeTransport {
  let inbound: ((frame: unknown) => void) | null = null;
  let closeCb: (() => void) | null = null;
  return {
    ...flags,
    send: jest.fn(),
    onMessage: (cb) => {
      inbound = cb;
      return () => {
        inbound = null;
      };
    },
    onClose: (cb) => {
      closeCb = cb;
      return () => {
        closeCb = null;
      };
    },
    destroy: jest.fn(),
    fire: (frame) => inbound?.(frame),
    close: () => closeCb?.(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(config: ConstructorParameters<typeof BrokerCore<Topics, Payloads>>[0] = {}) {
  const logger = quietLogger();
  const core = new BrokerCore<Topics, Payloads>({ logger, ...config });
  const events: Array<[string, unknown]> = [];
  core.$systemEvents.onAny((name, payload) => {
    events.push([name, payload]);
  });
  return { core, logger, events };
}

describe('createRemoteClient — registration', () => {
  test('registers under the client namespace and reports itself to the inspector', () => {
    const { core, events } = setup();
    const transport = fakeTransport();
    const remote = core.createRemoteClient('backend', { transport, accepts: ['a.*'] });

    expect(remote.id).toBe('backend');
    expect(remote.kind).toBe('custom');
    expect(remote.identity).toBe('fixed');
    expect(remote.requests).toBe(true);
    expect(core.getRemoteClient('backend')).toBe(remote);

    const info = core.inspect.getClients().find((c) => c.id === 'backend');
    expect(info?.remote).toEqual({
      kind: 'custom',
      identity: 'fixed',
      duplex: true,
      fanout: false,
      requests: true,
      accepts: ['a.*'],
      pending: 0,
    });
    expect(events.map(([n]) => n)).toEqual(['remote.created', 'client.registered']);
    core.destroy();
  });

  test('id shared with a local client is refused in both directions', () => {
    const { core } = setup();
    new BrokerClient('cart', core);
    expect(() => core.createRemoteClient('cart', { transport: fakeTransport() })).toThrow(/CLIENT_ID_TAKEN|already taken/);

    core.createRemoteClient('backend', { transport: fakeTransport() });
    expect(() => new BrokerClient('backend', core)).toThrow(/already taken/);
    core.destroy();
  });

  test('unknown descriptor kind throws TRANSPORT_UNSUPPORTED listing the built-ins', () => {
    expect(() => createTransport({ kind: 'carrier-pigeon' } as never)).toThrow(/carrier-pigeon.*websocket/);
    const { core } = setup();
    expect(() => core.createRemoteClient('x', { transport: { kind: 'nope' } as never })).toThrow(/unsupported transport kind/);
    core.destroy();
  });

  test('capabilities advertise the built-in transport kinds', () => {
    const { core } = setup();
    expect([...core.capabilities]).toEqual(
      expect.arrayContaining(['transport.websocket', 'transport.sse', 'transport.postmessage', 'transport.message-port', 'transport.broadcast-channel']),
    );
    core.destroy();
  });
});

describe('outbound — forward', () => {
  test('a local multicast matching a forward pattern goes out as a frame without local-only flags', async () => {
    const { core } = setup();
    const transport = fakeTransport();
    const remote = core.createRemoteClient('backend', { transport });
    remote.forward('cart.*');
    const cart = new BrokerClient('cart', core);

    await cart.emit('cart.snapshot.v1', { items: 2 });
    expect(transport.send).toHaveBeenCalledTimes(1);
    const frame = transport.send.mock.calls[0]![0];
    expect(frame).toEqual({
      v: 1,
      id: expect.any(String),
      origin: expect.any(String),
      kind: 'event',
      topic: 'cart.snapshot.v1',
      source: 'cart',
      target: '*',
      data: { items: 2 },
      timestamp: expect.any(Number),
    });
    expect('via' in frame).toBe(false);
    expect('fromExternal' in frame).toBe(false);

    await cart.emit('a.v1', { n: 1 });
    expect(transport.send).toHaveBeenCalledTimes(1);
    core.destroy();
  });

  test('a request to a local recipient never goes to a remote, even on a forwarded topic', async () => {
    const { core } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport, forward: ['a.*'] });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', () => 'ok');

    const result = await sender.request('receiver', 'a.v1', { n: 1 });
    expect(result.status).toBe('ACK');
    expect(transport.send).not.toHaveBeenCalled();
    core.destroy();
  });

  test('forward() runs onSubscribe hooks with the remote id and throws on denial', () => {
    const { core, events } = setup();
    core.useOnSubscribeHook((topic, clientId) =>
      clientId === 'tabs' && (topic as string) === 'a.*'
        ? { allowed: false, message: 'tabs may not see a.*' }
        : { allowed: true },
    );
    const remote = core.createRemoteClient('tabs', { transport: fakeTransport() });
    expect(() => remote.forward('a.*')).toThrow('tabs may not see a.*');
    expect(remote.forwardPatterns).toEqual([]);
    expect(events.find(([n]) => n === 'subscription.rejected')?.[1]).toEqual({
      clientId: 'tabs',
      topic: 'a.*',
      reason: 'tabs may not see a.*',
    });

    const off = remote.forward(['b.*', 'cart.*']);
    expect(remote.forwardPatterns).toEqual(['b.*', 'cart.*']);
    off();
    expect(remote.forwardPatterns).toEqual([]);
    core.destroy();
  });

  test('a denied initial forward rolls the remote back entirely', () => {
    const { core } = setup();
    core.useOnSubscribeHook(() => ({ allowed: false, message: 'no' }));
    const transport = fakeTransport();
    expect(() => core.createRemoteClient('tabs', { transport, forward: ['a.*'] })).toThrow('no');
    expect(core.getRemoteClient('tabs')).toBeUndefined();
    expect(transport.destroy).toHaveBeenCalled();
    core.destroy();
  });

  test('outbound waits for transport.ready; a transport that never opens reports remote.send.failed', async () => {
    const { core, events } = setup();
    let open!: () => void;
    const ready = new Promise<void>((r) => (open = r));
    const transport = fakeTransport({ ready });
    core.createRemoteClient('backend', { transport, forward: ['a.*'] });
    const sender = new BrokerClient('sender', core);

    await sender.emit('a.v1', { n: 1 });
    expect(transport.send).not.toHaveBeenCalled();
    open();
    await tick();
    expect(transport.send).toHaveBeenCalledTimes(1);

    let fail!: (e: Error) => void;
    const neverReady = new Promise<void>((_, rej) => (fail = rej));
    const dead = fakeTransport({ ready: neverReady });
    core.createRemoteClient('dead', { transport: dead, forward: ['a.*'] });
    await sender.emit('a.v1', { n: 2 });
    fail(new Error('closed'));
    await tick();
    expect(dead.send).not.toHaveBeenCalled();
    expect(events.find(([n]) => n === 'remote.send.failed')?.[1]).toMatchObject({
      remoteId: 'dead',
      topic: 'a.v1',
      reason: 'NOT_OPEN',
    });
    core.destroy();
  });

  test('a throwing transport.send is isolated: the emitter still gets ACK, remote.send.failed fires', async () => {
    const { core, events, logger } = setup();
    const transport = fakeTransport();
    transport.send.mockImplementation(() => {
      throw new Error('wire down');
    });
    core.createRemoteClient('backend', { transport, forward: ['a.*'] });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', () => {});

    const result = await sender.emit('a.v1', { n: 1 });
    expect(result.status).toBe('ACK');
    expect(events.find(([n]) => n === 'remote.send.failed')?.[1]).toMatchObject({
      remoteId: 'backend',
      reason: 'TRANSPORT_THREW',
    });
    expect(logger.calls.some(([e]) => e === 'remote.send.failed')).toBe(true);
    core.destroy();
  });
});

describe('inbound — accepts and identity', () => {
  test('fixed identity: frames without source or with source === id are emitted as the remote', async () => {
    const { core } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport, accepts: ['a.v1'] });
    const seen: Message[] = [];
    const local = new BrokerClient('local', core);
    local.on('a.v1', (m) => {
      seen.push(m);
    });

    transport.fire({ topic: 'a.v1', target: '*', data: { n: 1 } });
    transport.fire(JSON.stringify({ topic: 'a.v1', source: 'backend', target: '*', data: { n: 2 } }));
    await tick();
    expect(seen.map((m) => [m.source, m.data.n, m.via, m.fromExternal])).toEqual([
      ['backend', 1, 'backend', true],
      ['backend', 2, 'backend', true],
    ]);
    core.destroy();
  });

  test('fixed identity: a foreign source is rejected with SOURCE_MISMATCH', async () => {
    const { core, events } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport, accepts: ['a.v1'] });
    const handler = jest.fn();
    new BrokerClient('local', core).on('a.v1', handler);

    transport.fire({ topic: 'a.v1', source: 'cart', target: '*', data: { n: 1 } });
    await tick();
    expect(handler).not.toHaveBeenCalled();
    expect(events.find(([n]) => n === 'remote.frame.rejected')?.[1]).toEqual({
      remoteId: 'backend',
      reason: 'SOURCE_MISMATCH',
      source: 'cart',
      topic: 'a.v1',
    });
    core.destroy();
  });

  test('allow identity: listed sources pass through, others are SOURCE_NOT_ALLOWED', async () => {
    const { core, events } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('gateway', {
      transport,
      identity: { mode: 'allow', sources: ['orders-svc', 'stock-svc'] },
      accepts: ['a.v1'],
    });
    const seen: string[] = [];
    new BrokerClient('local', core).on('a.v1', (m) => {
      seen.push(m.source);
    });

    transport.fire({ topic: 'a.v1', source: 'orders-svc', target: '*', data: { n: 1 } });
    transport.fire({ topic: 'a.v1', source: 'gateway', target: '*', data: { n: 2 } });
    transport.fire({ topic: 'a.v1', target: '*', data: { n: 3 } });
    await tick();
    expect(seen).toEqual(['orders-svc']);
    const reasons = events.filter(([n]) => n === 'remote.frame.rejected').map(([, p]) => (p as { reason: string }).reason);
    expect(reasons).toEqual(['SOURCE_NOT_ALLOWED', 'SOURCE_NOT_ALLOWED']);
    core.destroy();
  });

  test('prefix identity: source is prefixed so it cannot collide with a local client', async () => {
    const { core, events } = setup();
    const transport = fakeTransport({ fanout: true });
    const remote = core.createRemoteClient('tabs', {
      transport,
      identity: { mode: 'prefix', prefix: 'tab' },
      accepts: ['cart.snapshot.v1'],
    });
    expect(remote.requests).toBe(false);
    const seen: string[] = [];
    new BrokerClient('cart-store', core).on('cart.snapshot.v1', (m) => {
      seen.push(m.source);
    });

    transport.fire({ topic: 'cart.snapshot.v1', source: 'cart-store', target: '*', data: { items: 1 } });
    transport.fire({ topic: 'cart.snapshot.v1', target: '*', data: { items: 1 } });
    await tick();
    expect(seen).toEqual(['tab:cart-store']);
    expect(events.find(([n]) => n === 'remote.frame.rejected')?.[1]).toMatchObject({ reason: 'MALFORMED' });

    const noPrefix = core.createRemoteClient('worker', {
      transport: fakeTransport(),
      identity: { mode: 'prefix' },
    });
    expect(noPrefix.identity).toBe('prefix');
    core.destroy();
  });

  test('topics outside accepts are dropped before hooks with TOPIC_NOT_ACCEPTED; accept() extends the set', async () => {
    const { core, events } = setup();
    const beforeSend = jest.fn(() => ({ allowed: true as const }));
    core.useBeforeSendHook(beforeSend);
    const transport = fakeTransport();
    const remote = core.createRemoteClient('backend', { transport, accepts: ['a.*'] });

    transport.fire({ topic: 'b.v1', target: '*', data: { n: 1 } });
    await tick();
    expect(beforeSend).not.toHaveBeenCalled();
    expect(events.find(([n]) => n === 'remote.frame.rejected')?.[1]).toMatchObject({ reason: 'TOPIC_NOT_ACCEPTED', topic: 'b.v1' });

    const off = remote.accept('b.v1');
    transport.fire({ topic: 'b.v1', target: '*', data: { n: 1 } });
    await tick();
    expect(beforeSend).toHaveBeenCalledTimes(1);
    off();
    expect(remote.acceptPatterns).toEqual(['a.*']);
    core.destroy();
  });

  test('malformed frames, unknown kinds and response frames never reach the pipeline', async () => {
    const { core, events } = setup();
    const beforeSend = jest.fn(() => ({ allowed: true as const }));
    core.useBeforeSendHook(beforeSend);
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport, accepts: ['*'] });

    transport.fire('not json');
    transport.fire(42);
    transport.fire({ topic: '', target: '*', data: 1 });
    transport.fire({ topic: 'a.v1', target: '*' });
    transport.fire({ topic: 'a.v1', target: '*', data: 1, source: 7 });
    transport.fire({ topic: 'a.v1', target: '*', data: 1, kind: 'gossip' });
    // A response missing its required fields is malformed …
    transport.fire({ topic: 'a.v1', target: '*', data: 1, kind: 'response' });
    // … a well-formed one is dropped silently until requests land (step 5).
    transport.fire({ kind: 'response', correlationId: 'r-1', topic: 'a.v1', source: 'backend', target: 'local', status: 'ACK', reason: 'DELIVERED' });
    await tick();
    expect(beforeSend).not.toHaveBeenCalled();
    const reasons = events.filter(([n]) => n === 'remote.frame.rejected').map(([, p]) => (p as { reason: string }).reason);
    expect(reasons).toEqual(['MALFORMED', 'MALFORMED', 'MALFORMED', 'MALFORMED', 'MALFORMED', 'UNSUPPORTED', 'MALFORMED']);
    core.destroy();
  });

  test('wire v1: v > 1 is UNSUPPORTED, an echo of our own origin is ECHO, wireId and ext land on the message', async () => {
    const { core, events } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport, accepts: ['a.v1'], forward: ['a.*'] });
    const seen: Message[] = [];
    const local = new BrokerClient('local', core);
    local.on('a.v1', (m) => {
      seen.push(m);
    });

    // Learn our own origin from an outbound frame.
    await local.emit('a.v1', { n: 0 });
    const ownOrigin = (transport.send.mock.calls[0]![0] as { origin: string }).origin;
    expect(ownOrigin).toEqual(expect.any(String));

    transport.fire({ v: 2, topic: 'a.v1', target: '*', data: { n: 1 } });
    transport.fire({ v: 1, origin: ownOrigin, topic: 'a.v1', target: '*', data: { n: 2 } });
    transport.fire({
      v: 1,
      id: 'wire-7',
      origin: 'peer-realm',
      kind: 'event',
      topic: 'a.v1',
      source: 'backend',
      target: '*',
      data: { n: 3 },
      ext: { traceparent: '00-abc', custom: { deep: true } },
    });
    await tick();

    const reasons = events.filter(([n]) => n === 'remote.frame.rejected').map(([, p]) => (p as { reason: string }).reason);
    expect(reasons).toEqual(['UNSUPPORTED', 'ECHO']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      data: { n: 3 },
      source: 'backend',
      via: 'backend',
      fromExternal: true,
      wireId: 'wire-7',
      ext: { traceparent: '00-abc', custom: { deep: true }, hedwig: { claimedSource: 'backend' } },
    });
    expect(seen[0]!.id).not.toBe('wire-7');
    // An inbound message is never re-forwarded, so the wire frame stays put.
    expect(transport.send).toHaveBeenCalledTimes(1);
    core.destroy();
  });

  test('wire v1: a legacy frame without v and kind is accepted; source-less fixed frames carry no claimedSource', async () => {
    const { core } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport, accepts: ['a.v1'] });
    const seen: Message[] = [];
    new BrokerClient('local', core).on('a.v1', (m) => {
      seen.push(m);
    });

    transport.fire({ topic: 'a.v1', target: '*', data: { n: 1 } });
    await tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.wireId).toBeUndefined();
    expect(seen[0]!.ext).toBeUndefined();
    core.destroy();
  });

  test('maxBytes and rateLimit drop frames at the edge', async () => {
    const { core, events } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('backend', {
      transport,
      accepts: ['*'],
      maxBytes: 64,
      rateLimit: { max: 2, window: 60_000 },
    });
    const handler = jest.fn();
    new BrokerClient('local', core).on('a.v1', handler);

    transport.fire(JSON.stringify({ topic: 'a.v1', target: '*', data: { pad: 'x'.repeat(100) } }));
    transport.fire({ topic: 'a.v1', target: '*', data: { n: 1 } });
    transport.fire({ topic: 'a.v1', target: '*', data: { n: 2 } });
    transport.fire({ topic: 'a.v1', target: '*', data: { n: 3 } });
    await tick();
    expect(handler).toHaveBeenCalledTimes(2);
    const reasons = events.filter(([n]) => n === 'remote.frame.rejected').map(([, p]) => (p as { reason: string }).reason);
    expect(reasons).toEqual(['TOO_LARGE', 'RATE_LIMITED']);
    core.destroy();
  });

  test('an inbound message is not echoed back to the remote it came from, nor to other remotes', async () => {
    const { core } = setup();
    const a = fakeTransport();
    const b = fakeTransport();
    core.createRemoteClient('a', { transport: a, accepts: ['a.v1'], forward: ['a.*'] });
    core.createRemoteClient('b', { transport: b, forward: ['a.*'] });
    new BrokerClient('local', core).on('a.v1', () => {});

    a.fire({ topic: 'a.v1', target: '*', data: { n: 1 } });
    await tick();
    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).not.toHaveBeenCalled();
    core.destroy();
  });

  test('beforeSend hooks see via and fromExternal on remote-originated messages', async () => {
    const { core } = setup();
    const seen: Array<[string | undefined, boolean | undefined]> = [];
    core.useBeforeSendHook((m) => {
      seen.push([m.via, m.fromExternal]);
      return { allowed: true };
    });
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport, accepts: ['a.v1'] });
    transport.fire({ topic: 'a.v1', target: '*', data: { n: 1 } });
    await tick();
    expect(seen).toEqual([['backend', true]]);
    core.destroy();
  });
});

describe('lifecycle', () => {
  test('destroy() closes the transport, drops subscriptions and unregisters; idempotent', () => {
    const { core, events } = setup();
    const transport = fakeTransport();
    const remote = core.createRemoteClient('backend', { transport, forward: ['a.*'] });
    events.length = 0;

    remote.destroy();
    remote.destroy();
    expect(transport.destroy).toHaveBeenCalledTimes(1);
    expect(core.getRemoteClient('backend')).toBeUndefined();
    expect(events.map(([n]) => n)).toEqual(['subscription.removed', 'remote.destroyed', 'client.unregistered']);
    expect(() => remote.forward('b.*')).toThrow(/destroyed/);
    core.destroy();
  });

  test('transport onClose tears the remote down', () => {
    const { core } = setup();
    const transport = fakeTransport();
    core.createRemoteClient('backend', { transport });
    transport.close();
    expect(core.getRemoteClient('backend')).toBeUndefined();
    expect(transport.destroy).toHaveBeenCalledTimes(1);
    core.destroy();
  });

  test('the id is free again after destroy; core.destroy() destroys remotes', () => {
    const { core } = setup();
    const t1 = fakeTransport();
    core.createRemoteClient('backend', { transport: t1 }).destroy();
    const t2 = fakeTransport();
    core.createRemoteClient('backend', { transport: t2 });
    core.destroy();
    expect(t2.destroy).toHaveBeenCalledTimes(1);
  });

  test('createRemoteClient after core.destroy() throws', () => {
    const { core } = setup();
    core.destroy();
    expect(() => core.createRemoteClient('x', { transport: fakeTransport() })).toThrow(/destroyed/);
  });
});

describe('built-in transports', () => {
  test('message-port descriptor: two brokers talk over a MessageChannel with prefix identities', async () => {
    const { port1, port2 } = new MessageChannel();
    const shell = setup().core;
    const worker = setup().core;
    try {
      // Each side is a foreign realm with its own clients → prefix mode, so
      // `emitter` on the far side becomes `worker:emitter` / `shell:emitter`.
      shell.createRemoteClient('worker', {
        transport: { kind: 'message-port', port: port1 },
        identity: { mode: 'prefix' },
        accepts: ['b.*'],
        forward: ['a.*'],
      });
      worker.createRemoteClient('shell', {
        transport: { kind: 'message-port', port: port2 },
        identity: { mode: 'prefix' },
        accepts: ['a.*'],
        forward: ['b.*'],
      });

      const inWorker: Message[] = [];
      new BrokerClient('w', worker).on('a.v1', (m) => {
        inWorker.push(m);
      });
      const inShell: Message[] = [];
      new BrokerClient('s', shell).on('b.v1', (m) => {
        inShell.push(m);
      });

      await new BrokerClient('emitter', shell).emit('a.v1', { n: 1 });
      await new BrokerClient('emitter', worker).emit('b.v1', { n: 2 });
      await new Promise((r) => setTimeout(r, 20));

      expect(inWorker.map((m) => [m.source, m.via, m.data.n])).toEqual([['shell:emitter', 'shell', 1]]);
      expect(inShell.map((m) => [m.source, m.via, m.data.n])).toEqual([['worker:emitter', 'worker', 2]]);
    } finally {
      shell.destroy();
      worker.destroy();
    }
  });

  test('MessagePortTransport.destroy() closes the port and stops delivering', async () => {
    const { port1, port2 } = new MessageChannel();
    const t = new MessagePortTransport(port1);
    const cb = jest.fn();
    t.onMessage(cb);
    port2.postMessage({ hello: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(cb).toHaveBeenCalledWith({ hello: 1 });
    t.destroy();
    port2.postMessage({ hello: 2 });
    await new Promise((r) => setTimeout(r, 10));
    expect(cb).toHaveBeenCalledTimes(1);
    port2.close();
  });

  test('flags: sse is not duplex, broadcast-channel is fan-out', () => {
    const g = globalThis as { EventSource?: unknown; BroadcastChannel?: unknown };
    const originals = { EventSource: g.EventSource, BroadcastChannel: g.BroadcastChannel };
    try {
      const es = { addEventListener: jest.fn(), removeEventListener: jest.fn(), close: jest.fn() };
      g.EventSource = jest.fn(() => es);
      const sse = new SSETransport({ url: '/x' });
      expect(sse.duplex).toBe(false);

      const bc = { postMessage: jest.fn(), close: jest.fn(), onmessage: null };
      g.BroadcastChannel = jest.fn(() => bc);
      const chan = new BroadcastChannelTransport('x');
      expect(chan.fanout).toBe(true);
    } finally {
      g.EventSource = originals.EventSource;
      g.BroadcastChannel = originals.BroadcastChannel;
    }
  });
});
