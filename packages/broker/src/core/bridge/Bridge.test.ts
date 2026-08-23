import { Bridge } from './Bridge';
import { defaultLogger } from '../logger/BrokerLogger.types';
import type { BridgeTransport } from './Bridge.types';
import type { Message } from '../types';

/**
 * Unit tests for Bridge.
 *
 * Bridge sits on the boundary between the broker and the outside world
 * (iframes, tabs, servers). Its error-paths are the ones most likely to bite
 * in production: corrupted JSON from the wire, unexpected shapes, partial
 * data. These tests drive every branch of `#parseMessage` and `#handleIncoming`
 * directly through the mocked bridge transport, because integration tests in
 * `BrokerCore.test.ts` cannot simulate "the other side sent garbage".
 *
 * No jsdom needed: Bridge depends only on the `BridgeTransport` abstraction,
 * is trivially mocked with `jest.fn()`.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TestTopics = 'user.login.v1' | 'order.placed.v1';
type TestPayloads = {
  'user.login.v1': { userId: string };
  'order.placed.v1': { orderId: string };
};

/**
 * Controllable BridgeTransport stub. Captures the `onMessage` callback so tests can
 * fire simulated inbound data via `fireIncoming(data)`.
 */
function createTransport() {
  let capturedCallback: ((data: unknown) => void) | null = null;
  const unsubscribe = jest.fn();

  const transport: BridgeTransport = {
    send: jest.fn(),
    onMessage: jest.fn((cb) => {
      capturedCallback = cb;
      return unsubscribe;
    }),
    destroy: jest.fn(),
  };

  return {
    transport,
    unsubscribe,
    /** Simulate a message arriving from the other side of the transport. */
    fireIncoming: (data: unknown) => {
      if (!capturedCallback) throw new Error('onMessage was not subscribed');
      capturedCallback(data);
    },
  };
}

/**
 * Injectable callback stub — Bridge receives only this, not BrokerCore.
 */
function createInjectStub() {
  return jest.fn().mockResolvedValue(undefined);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Bridge', () => {
  describe('constructor', () => {
    test('subscribes to transport.onMessage immediately', () => {
      const { transport } = createTransport();
      const inject = createInjectStub();

      new Bridge(inject, { transport, forward: ['user.*'] }, defaultLogger);

      expect(transport.onMessage).toHaveBeenCalledTimes(1);
    });

    test('stores forwardPatterns and exposes them read-only', () => {
      const { transport } = createTransport();
      const inject = createInjectStub();

      const bridge = new Bridge(inject, {
        transport,
        forward: ['user.*', 'order.*'],
      }, defaultLogger);

      expect(bridge.forwardPatterns).toEqual(['user.*', 'order.*']);
    });
  });

  describe('shouldForward', () => {
    test.each([
      ['user.login.v1', ['user.*'], true],
      ['order.placed.v1', ['user.*'], false],
      ['anything.v1', ['*'], true],
      ['user.login.v1', ['user.login.v1'], true], // exact match
      ['user.login.v2', ['user.login.v1'], false], // no wildcard, no match
      ['nothing', [], false], // empty patterns match nothing
    ])('topic "%s" against %p → %s', (topic, patterns, expected) => {
      const { transport } = createTransport();
      const bridge = new Bridge(createInjectStub(), { transport, forward: patterns }, defaultLogger);

      expect(bridge.shouldForward(topic)).toBe(expected);
    });
  });

  describe('send (OUTBOUND)', () => {
    test('delegates raw message to transport.send verbatim', () => {
      const { transport } = createTransport();
      const bridge = new Bridge(createInjectStub(), { transport, forward: ['*'] }, defaultLogger);

      const message: Message = {
        id: 'm-1',
        topic: 'user.login.v1',
        source: 'alice',
        target: '*',
        data: { userId: '42' },
        timestamp: 123,
      };

      bridge.send(message);

      expect(transport.send).toHaveBeenCalledTimes(1);
      expect(transport.send).toHaveBeenCalledWith(message);
    });
  });

  describe('handleIncoming (INBOUND)', () => {
    const validMessage: Message = {
      id: 'm-1',
      topic: 'user.login.v1',
      source: 'remote',
      target: '*',
      data: { userId: '42' },
      timestamp: 123,
    };

    describe('happy path', () => {
      test('object payload → inject callback called', () => {
        const { transport, fireIncoming } = createTransport();
        const inject = createInjectStub();
        new Bridge(inject, { transport, forward: ['user.*'] }, defaultLogger);

        fireIncoming(validMessage);

        expect(inject).toHaveBeenCalledTimes(1);
        expect(inject).toHaveBeenCalledWith(
          validMessage.topic,
          validMessage.source,
          validMessage.target,
          validMessage.data,
        );
      });

      test('JSON-string payload is parsed before routing', () => {
        const { transport, fireIncoming } = createTransport();
        const inject = createInjectStub();
        new Bridge(inject, { transport, forward: ['user.*'] }, defaultLogger);

        fireIncoming(JSON.stringify(validMessage));

        expect(inject).toHaveBeenCalledTimes(1);
        expect(inject).toHaveBeenCalledWith(
          validMessage.topic,
          validMessage.source,
          validMessage.target,
          validMessage.data,
        );
      });
    });

    describe('silent drop paths', () => {
      test('corrupted JSON string is logged and dropped', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { transport, fireIncoming } = createTransport();
        const inject = createInjectStub();
        new Bridge(inject, { transport, forward: ['user.*'] }, defaultLogger);

        fireIncoming('{ not valid json');

        expect(inject).not.toHaveBeenCalled();
        expect(spy).toHaveBeenCalledWith(
          '[broker] bridge.message.parse_failed',
          { error: expect.any(SyntaxError) },
        );
        spy.mockRestore();
      });

      test.each([
        ['null', null],
        ['undefined', undefined],
        ['number', 42],
        ['boolean', true],
      ])('primitive payload (%s) is dropped', (_label, payload) => {
        const { transport, fireIncoming } = createTransport();
        const inject = createInjectStub();
        new Bridge(inject, { transport, forward: ['user.*'] }, defaultLogger);

        fireIncoming(payload);

        expect(inject).not.toHaveBeenCalled();
      });

      test('object without `topic` field is dropped', () => {
        const { transport, fireIncoming } = createTransport();
        const inject = createInjectStub();
        new Bridge(inject, { transport, forward: ['*'] }, defaultLogger);

        fireIncoming({ source: 'x', target: 'y', data: {} });

        expect(inject).not.toHaveBeenCalled();
      });

      test('object with non-string `topic` is dropped', () => {
        const { transport, fireIncoming } = createTransport();
        const inject = createInjectStub();
        new Bridge(inject, { transport, forward: ['*'] }, defaultLogger);

        fireIncoming({ topic: 123, source: 'x', target: 'y', data: {} });

        expect(inject).not.toHaveBeenCalled();
      });

      test('topic that does NOT match forward patterns is dropped', () => {
        const { transport, fireIncoming } = createTransport();
        const inject = createInjectStub();
        new Bridge(inject, { transport, forward: ['user.*'] }, defaultLogger);

        fireIncoming({ ...validMessage, topic: 'order.placed.v1' });

        expect(inject).not.toHaveBeenCalled();
      });
    });
  });

  describe('destroy', () => {
    test('calls transport-provided unsubscribe and transport.destroy', () => {
      const { transport, unsubscribe } = createTransport();
      const bridge = new Bridge(createInjectStub(), { transport, forward: ['*'] }, defaultLogger);

      bridge.destroy();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(transport.destroy).toHaveBeenCalledTimes(1);
    });

    test('is idempotent: unsubscribe is called only once', () => {
      const { transport, unsubscribe } = createTransport();
      const bridge = new Bridge(createInjectStub(), { transport, forward: ['*'] }, defaultLogger);

      bridge.destroy();
      bridge.destroy();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      // transport.destroy is still called each time — it's the transport's
      // own job to be idempotent; Bridge guarantees only that it doesn't
      // double-unsubscribe the listener.
      expect(transport.destroy).toHaveBeenCalledTimes(2);
    });

    test('after destroy, inbound data from (already-detached) transport is still handled gracefully if fired', () => {
      // This test guards against regressions where destroy would leave Bridge
      // in a half-dead state that crashes if the transport still calls the
      // captured callback (e.g. a queued message firing after unsubscribe).
      const { transport, fireIncoming } = createTransport();
      const inject = createInjectStub();
      const bridge = new Bridge(inject, { transport, forward: ['*'] }, defaultLogger);

      bridge.destroy();

      expect(() => {
        fireIncoming({
          id: 'm-late',
          topic: 'user.login.v1',
          source: 'remote',
          target: '*',
          data: {},
          timestamp: 0,
        });
      }).not.toThrow();
    });
  });
});
