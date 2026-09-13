import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import { RoutingReason } from './routing/RoutingResult';
import type { BrokerLogger } from './logger/BrokerLogger.types';
import type { Transport } from './transport/Transport.types';

/**
 * Fault-isolation tests.
 *
 * The broker pipeline is shared infrastructure: a single failing consumer —
 * a handler, a logger sink, a transport, a payload shape — must never take
 * the bus down for everyone else. Each block below pins one isolation
 * guarantee with the concrete failure that used to break it.
 */

type Topics = 'a.v1' | 'b.v1' | 'blob.v1';
type Payloads = {
  'a.v1': { n: number };
  'b.v1': { n: number };
  'blob.v1': { bytes: Uint8Array; meta: { len: number } };
};

function throwingLogger(): BrokerLogger {
  return {
    warn: jest.fn(() => {
      throw new Error('sink down (warn)');
    }),
    error: jest.fn(() => {
      throw new Error('sink down (error)');
    }),
  };
}

function recordingLogger(): BrokerLogger & { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    warn: (event, meta) => {
      calls.push(['warn', event, meta]);
    },
    error: (event, meta) => {
      calls.push(['error', event, meta]);
    },
  };
}

function fakeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    send: jest.fn(),
    onMessage: jest.fn(() => () => {}),
    destroy: jest.fn(),
    ...overrides,
  };
}

function throwingTransport(): Transport {
  return fakeTransport({
    send: jest.fn(() => {
      throw new Error('wire down');
    }),
  });
}

describe('BrokerCore fault isolation', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. A throwing logger must not reject emit() / request()
  // ─────────────────────────────────────────────────────────────────────────

  describe('throwing logger', () => {
    test('request() resolves NACK HANDLER_FAILED instead of rejecting when the logger throws', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: throwingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      receiver.on('a.v1', () => {
        throw new Error('handler boom');
      });

      const result = await sender.request('receiver', 'a.v1', { n: 1 });

      expect(result.status).toBe('NACK');
      expect(result.reason).toBe(RoutingReason.HANDLER_FAILED);
      expect(consoleError).toHaveBeenCalledWith(
        '[broker] logger.failed',
        expect.objectContaining({ event: 'handler.failed' }),
      );
      core.destroy();
    });

    test('emit() resolves ACK and still reaches other subscribers when one handler throws and the logger throws', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: throwingLogger() });
      const sender = new BrokerClient('sender', core);
      const bad = new BrokerClient('bad', core);
      const good = new BrokerClient('good', core);

      bad.on('a.v1', () => {
        throw new Error('handler boom');
      });
      const goodHandler = jest.fn();
      good.on('a.v1', goodHandler);

      const result = await sender.emit('a.v1', { n: 1 });

      expect(result.status).toBe('ACK');
      expect(result.recipientIds).toEqual(expect.arrayContaining(['bad', 'good']));
      expect(goodHandler).toHaveBeenCalledTimes(1);
      core.destroy();
    });

    test('a throwing afterSend hook plus a throwing logger still lets the message through', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: throwingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const handler = jest.fn();
      receiver.on('a.v1', handler);

      core.useAfterSendHook(() => {
        throw new Error('hook boom');
      });

      const result = await sender.emit('a.v1', { n: 1 });

      expect(result.status).toBe('ACK');
      expect(handler).toHaveBeenCalledTimes(1);
      core.destroy();
    });

    test('a throwing logger during subscribe-after-destroy warning does not throw from on()', () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: throwingLogger() });
      const client = new BrokerClient('c', core);
      core.destroy();

      expect(() => client.on('a.v1', () => {})).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. A throwing transport.send() must not reject emit() or starve other remotes
  // ─────────────────────────────────────────────────────────────────────────

  describe('throwing transport', () => {
    test('emit() resolves ACK even though a remote transport threw on send()', async () => {
      const logger = recordingLogger();
      const core = new BrokerCore<Topics, Payloads>({ logger });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const handler = jest.fn();
      receiver.on('a.v1', handler);

      core.createRemoteClient('bad', { transport: throwingTransport(), forward: ['a.*'] });

      const result = await sender.emit('a.v1', { n: 1 });

      expect(result.status).toBe('ACK');
      expect(result.reason).toBe(RoutingReason.DISPATCHED);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(logger.calls).toContainEqual([
        'error',
        'remote.send.failed',
        expect.objectContaining({ remoteId: 'bad', topic: 'a.v1', messageId: expect.any(String) }),
      ]);
      core.destroy();
    });

    test('request() resolves with the handler result even though a remote transport threw', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', (msg) => ({ echoed: msg.data.n }));

      core.createRemoteClient('bad', { transport: throwingTransport(), forward: ['a.*'] });

      const result = await sender.request<'a.v1', { echoed: number }>('receiver', 'a.v1', { n: 7 });

      expect(result.status).toBe('ACK');
      expect(result.data).toEqual({ echoed: 7 });
      core.destroy();
    });

    test('remotes registered after a throwing one still receive the message', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});

      const good = fakeTransport();
      core.createRemoteClient('bad', { transport: throwingTransport(), forward: ['a.*'] });
      core.createRemoteClient('good', { transport: good, forward: ['a.*'] });

      await sender.emit('a.v1', { n: 1 });

      expect(good.send).toHaveBeenCalledTimes(1);
      expect(good.send).toHaveBeenCalledWith(expect.objectContaining({ topic: 'a.v1', data: { n: 1 } }));
      core.destroy();
    });

    test('emits remote.send.failed on $systemEvents with remote id, topic, message id, reason and error', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});
      core.createRemoteClient('bad', { transport: throwingTransport(), forward: ['a.*'] });

      const seen: unknown[] = [];
      core.$systemEvents.on('remote.send.failed', (payload) => seen.push(payload));
      let sentId = '';
      core.useAfterSendHook((message) => {
        sentId = message.id;
      });

      await sender.emit('a.v1', { n: 1 });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({
        remoteId: 'bad',
        topic: 'a.v1',
        messageId: sentId,
        reason: 'TRANSPORT_THREW',
        error: expect.any(Error),
      });
      core.destroy();
    });

    test('a remote whose forward patterns do not match is never invoked, so it cannot fail', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});
      const bad = throwingTransport();
      core.createRemoteClient('bad', { transport: bad, forward: ['b.*'] });

      const seen = jest.fn();
      core.$systemEvents.on('remote.send.failed', seen);

      await sender.emit('a.v1', { n: 1 });

      expect(bad.send).not.toHaveBeenCalled();
      expect(seen).not.toHaveBeenCalled();
      core.destroy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Binary payloads must not break the immutability step
  // ─────────────────────────────────────────────────────────────────────────

  describe('binary payloads', () => {
    test('emit() with a Uint8Array payload resolves ACK and delivers the same bytes', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const received: Array<Payloads['blob.v1']> = [];
      receiver.on('blob.v1', (msg) => {
        received.push(msg.data);
      });

      const bytes = new Uint8Array([1, 2, 3]);
      const result = await sender.emit('blob.v1', { bytes, meta: { len: 3 } });

      expect(result.status).toBe('ACK');
      expect(received).toHaveLength(1);
      expect(received[0]!.bytes).toBe(bytes);
      expect(Array.from(received[0]!.bytes)).toEqual([1, 2, 3]);
      // The envelope and non-binary parts of the payload are still frozen.
      expect(Object.isFrozen(received[0])).toBe(true);
      expect(Object.isFrozen(received[0]!.meta)).toBe(true);
      core.destroy();
    });

    test('request() with a binary payload round-trips the handler response', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('blob.v1', (msg) => ({ sum: msg.data.bytes.reduce((a, b) => a + b, 0) }));

      const result = await sender.request<'blob.v1', { sum: number }>('receiver', 'blob.v1', {
        bytes: new Uint8Array([4, 5]),
        meta: { len: 2 },
      });

      expect(result.status).toBe('ACK');
      expect(result.data).toEqual({ sum: 9 });
      core.destroy();
    });

    test('a binary payload arriving from a remote client (structured clone) is routed, not dropped', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const receiver = new BrokerClient('receiver', core);
      const handler = jest.fn();
      receiver.on('blob.v1', handler);

      let inbound: ((data: unknown) => void) | null = null;
      const transport = fakeTransport({
        onMessage: jest.fn((cb) => {
          inbound = cb;
          return () => {};
        }),
      });
      core.createRemoteClient('iframe', { transport, accepts: ['blob.*'] });

      inbound!({
        id: 'remote-1',
        topic: 'blob.v1',
        source: 'iframe',
        target: '*',
        data: { bytes: new Uint8Array([7]), meta: { len: 1 } },
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(Array.from(handler.mock.calls[0]![0].data.bytes)).toEqual([7]);
      core.destroy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Subscribing / unsubscribing while a dispatch is in progress
  // ─────────────────────────────────────────────────────────────────────────

  describe('mutation during dispatch', () => {
    test('a handler that unsubscribes its sibling does not cause the NEXT sibling to be skipped', async () => {
      const core = new BrokerCore<Topics, Payloads>();
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const calls: string[] = [];

      let offH2: () => void = () => {};
      receiver.on('a.v1', () => {
        calls.push('h1');
        offH2();
      });
      offH2 = receiver.on('a.v1', () => calls.push('h2'));
      receiver.on('a.v1', () => calls.push('h3'));

      await sender.emit('a.v1', { n: 1 });

      // h2 was unsubscribed before its turn → not invoked; h3 must NOT be skipped.
      expect(calls).toEqual(['h1', 'h3']);
      core.destroy();
    });

    test('a handler that unsubscribes ANOTHER client mid-dispatch: that client is skipped, later clients still run', async () => {
      const core = new BrokerCore<Topics, Payloads>();
      const sender = new BrokerClient('sender', core);
      const a = new BrokerClient('a', core);
      const b = new BrokerClient('b', core);
      const c = new BrokerClient('c', core);
      const calls: string[] = [];

      a.on('a.v1', () => {
        calls.push('a');
        b.off('a.v1');
      });
      b.on('a.v1', () => calls.push('b'));
      c.on('a.v1', () => calls.push('c'));

      const result = await sender.emit('a.v1', { n: 1 });

      expect(calls).toEqual(['a', 'c']);
      expect(result.recipientIds).toEqual(['a', 'c']);
      core.destroy();
    });

    test('a client subscribed during dispatch does not receive the in-flight message, but does receive the next one', async () => {
      const core = new BrokerCore<Topics, Payloads>();
      const sender = new BrokerClient('sender', core);
      const a = new BrokerClient('a', core);
      const late = new BrokerClient('late', core);
      const lateCalls: number[] = [];

      a.on('a.v1', () => {
        if (lateCalls.length === 0 && !core.inspect.getSubscribedClientIds().includes('late')) {
          late.on('a.v1', (msg) => lateCalls.push(msg.data.n));
        }
      });

      const first = await sender.emit('a.v1', { n: 1 });
      expect(lateCalls).toEqual([]);
      expect(first.recipientIds).toEqual(['a']);

      const second = await sender.emit('a.v1', { n: 2 });
      expect(lateCalls).toEqual([2]);
      expect(second.recipientIds).toEqual(expect.arrayContaining(['a', 'late']));
      core.destroy();
    });

    test('a handler that unsubscribes itself ("once") runs exactly once and siblings still run', async () => {
      const core = new BrokerCore<Topics, Payloads>();
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const calls: string[] = [];

      const offOnce = receiver.on('a.v1', () => {
        calls.push('once');
        offOnce();
      });
      receiver.on('a.v1', () => calls.push('always'));

      await sender.emit('a.v1', { n: 1 });
      await sender.emit('a.v1', { n: 2 });

      expect(calls).toEqual(['once', 'always', 'always']);
      core.destroy();
    });

    test('re-entrant emit is delivered inline: other subscribers see the nested message before the outer one', async () => {
      const core = new BrokerCore<Topics, Payloads>();
      const sender = new BrokerClient('sender', core);
      const a = new BrokerClient('a', core);
      const b = new BrokerClient('b', core);
      const seenByB: string[] = [];

      a.on('a.v1', (msg) => {
        if (msg.data.n === 1) void a.emit('a.v1', { n: 2 });
      });
      b.on('a.v1', (msg) => seenByB.push(msg.data.n === 1 ? 'outer' : 'inner'));

      await sender.emit('a.v1', { n: 1 });

      // Documented behaviour (see Router.multicast JSDoc): nested dispatch
      // runs on a's stack, so b receives the inner message first.
      expect(seenByB).toEqual(['inner', 'outer']);
      core.destroy();
    });

    test('an afterSend hook that removes itself does not cause the next afterSend hook to be skipped', async () => {
      const core = new BrokerCore<Topics, Payloads>();
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});
      const calls: string[] = [];

      const offFirst = core.useAfterSendHook(() => {
        calls.push('first');
        offFirst();
      });
      core.useAfterSendHook(() => calls.push('second'));

      await sender.emit('a.v1', { n: 1 });
      await sender.emit('a.v1', { n: 2 });

      expect(calls).toEqual(['first', 'second', 'second']);
      core.destroy();
    });

    test('a beforeSend hook that removes itself does not cause the next guard to be skipped', async () => {
      const core = new BrokerCore<Topics, Payloads>();
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});
      const calls: string[] = [];

      const offFirst = core.useBeforeSendHook(() => {
        calls.push('first');
        offFirst();
        return { allowed: true };
      });
      core.useBeforeSendHook(() => {
        calls.push('second');
        return { allowed: false, message: 'blocked by second' };
      });

      const result = await sender.emit('a.v1', { n: 1 });

      expect(calls).toEqual(['first', 'second']);
      expect(result.reason).toBe(RoutingReason.HOOK_REJECTED);
      core.destroy();
    });
  });
});
