import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import { RoutingReason } from './routing/RoutingResult';
import type { BrokerLogger } from './logger/BrokerLogger.types';

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
});
