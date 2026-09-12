import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import { RoutingReason } from './routing/RoutingResult';
import type { BrokerLogger } from './logger/BrokerLogger.types';
import type { BridgeTransport } from './bridge/Bridge.types';

/**
 * Fault-isolation tests.
 *
 * The broker pipeline is shared infrastructure: a single failing consumer —
 * a handler, a logger sink, a transport, a payload shape — must never take
 * the bus down for everyone else. Each block below pins one isolation
 * guarantee with the concrete failure that used to break it.
 */

type Topics = 'a.v1' | 'b.v1';
type Payloads = { 'a.v1': { n: number }; 'b.v1': { n: number } };

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

function fakeTransport(overrides: Partial<BridgeTransport> = {}): BridgeTransport {
  return {
    send: jest.fn(),
    onMessage: jest.fn(() => () => {}),
    destroy: jest.fn(),
    ...overrides,
  };
}

function throwingTransport(): BridgeTransport {
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
  // 2. A throwing transport.send() must not reject emit() or starve other bridges
  // ─────────────────────────────────────────────────────────────────────────

  describe('throwing transport', () => {
    test('emit() resolves ACK even though a bridge transport threw on send()', async () => {
      const logger = recordingLogger();
      const core = new BrokerCore<Topics, Payloads>({ logger });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const handler = jest.fn();
      receiver.on('a.v1', handler);

      core.addBridge('bad', { transport: throwingTransport(), forward: ['a.*'] });

      const result = await sender.emit('a.v1', { n: 1 });

      expect(result.status).toBe('ACK');
      expect(result.reason).toBe(RoutingReason.DISPATCHED);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(logger.calls).toContainEqual([
        'error',
        'bridge.send.failed',
        expect.objectContaining({ bridgeId: 'bad', topic: 'a.v1', messageId: expect.any(String) }),
      ]);
      core.destroy();
    });

    test('request() resolves with the handler result even though a bridge transport threw', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', (msg) => ({ echoed: msg.data.n }));

      core.addBridge('bad', { transport: throwingTransport(), forward: ['a.*'] });

      const result = await sender.request<'a.v1', { echoed: number }>('receiver', 'a.v1', { n: 7 });

      expect(result.status).toBe('ACK');
      expect(result.data).toEqual({ echoed: 7 });
      core.destroy();
    });

    test('bridges registered after a throwing one still receive the message', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});

      const good = fakeTransport();
      core.addBridge('bad', { transport: throwingTransport(), forward: ['a.*'] });
      core.addBridge('good', { transport: good, forward: ['a.*'] });

      await sender.emit('a.v1', { n: 1 });

      expect(good.send).toHaveBeenCalledTimes(1);
      expect(good.send).toHaveBeenCalledWith(expect.objectContaining({ topic: 'a.v1', data: { n: 1 } }));
      core.destroy();
    });

    test('emits bridge.send.failed on $systemEvents with bridge id, topic, message id and error', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});
      core.addBridge('bad', { transport: throwingTransport(), forward: ['a.*'] });

      const seen: unknown[] = [];
      core.$systemEvents.on('bridge.send.failed', (payload) => seen.push(payload));
      let sentId = '';
      core.useAfterSendHook((message) => {
        sentId = message.id;
      });

      await sender.emit('a.v1', { n: 1 });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({
        bridgeId: 'bad',
        topic: 'a.v1',
        messageId: sentId,
        error: expect.any(Error),
      });
      core.destroy();
    });

    test('a bridge whose forward patterns do not match is never invoked, so it cannot fail', async () => {
      const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      receiver.on('a.v1', () => {});
      const bad = throwingTransport();
      core.addBridge('bad', { transport: bad, forward: ['b.*'] });

      const seen = jest.fn();
      core.$systemEvents.on('bridge.send.failed', seen);

      await sender.emit('a.v1', { n: 1 });

      expect(bad.send).not.toHaveBeenCalled();
      expect(seen).not.toHaveBeenCalled();
      core.destroy();
    });
  });
});
