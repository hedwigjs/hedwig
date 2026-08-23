import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';

type TestTopic = 'user.created.v1' | 'order.placed.v1';
type TestPayloads = {
  'user.created.v1': { userId: string };
  'order.placed.v1': { orderId: string; amount: number };
};

/**
 * Integration tests: verifies BrokerCore emits system events at the correct
 * lifecycle points. Complements SystemEvents unit tests which cover the
 * event dispatcher itself.
 */
describe('BrokerCore system events', () => {
  let core: BrokerCore<TestTopic, TestPayloads>;

  beforeEach(() => {
    core = new BrokerCore<TestTopic, TestPayloads>();
  });

  afterEach(() => {
    core.destroy();
  });

  describe('client lifecycle', () => {
    test('emits client.registered with clientId and timestamp when a client is registered', () => {
      const listener = jest.fn();
      core.$systemEvents.on('client.registered', listener);

      new BrokerClient('alice', core); // registers via constructor

      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload.clientId).toBe('alice');
      expect(typeof payload.at).toBe('number');
    });

    test('emits client.unregistered when a client is unregistered', () => {
      const listener = jest.fn();
      new BrokerClient('alice', core);
      core.$systemEvents.on('client.unregistered', listener);

      core.unregisterClient('alice');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'alice' }),
      );
    });
  });

  describe('subscription lifecycle', () => {
    test('emits subscription.added when a subscription is successfully registered', () => {
      const listener = jest.fn();
      core.$systemEvents.on('subscription.added', listener);

      const client = new BrokerClient('alice', core);
      client.on('user.created.v1', () => {});

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'alice',
          topic: 'user.created.v1',
        }),
      );
    });

    test('does NOT emit subscription.added when onSubscribe guard blocks', () => {
      core.useOnSubscribeHook(() => ({ allowed: false, message: 'denied' }));
      const listener = jest.fn();
      core.$systemEvents.on('subscription.added', listener);

      const client = new BrokerClient('alice', core);
      expect(() => client.on('user.created.v1', () => {})).toThrow('denied');

      expect(listener).not.toHaveBeenCalled();
    });

    test('emits subscription.removed on unsubscribe', () => {
      const listener = jest.fn();
      const client = new BrokerClient('alice', core);
      client.on('user.created.v1', () => {});

      core.$systemEvents.on('subscription.removed', listener);
      core.unsubscribe('alice', 'user.created.v1');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'alice',
          topic: 'user.created.v1',
        }),
      );
    });

    test('does not emit subscription.removed when unsubscribing a non-existent subscription', () => {
      const listener = jest.fn();
      new BrokerClient('alice', core);
      core.$systemEvents.on('subscription.removed', listener);

      core.unsubscribe('alice', 'user.created.v1');

      expect(listener).not.toHaveBeenCalled();
    });

    test('unregisterClient emits subscription.removed for every active subscription, then client.unregistered', () => {
      const events: Array<{ name: string; payload: unknown }> = [];
      core.$systemEvents.onAny((event, payload) => {
        events.push({ name: String(event), payload });
      });

      const client = new BrokerClient('alice', core);
      client.on('user.created.v1', () => {});
      client.on('order.placed.v1', () => {});
      // Reset recorder — we only care about the unregister sequence.
      events.length = 0;

      core.unregisterClient('alice');

      const names = events.map((e) => e.name);
      expect(names).toEqual([
        'subscription.removed',
        'subscription.removed',
        'client.unregistered',
      ]);
    });
  });

  describe('bridge lifecycle', () => {
    test('emits bridge.added when a bridge is added, and bridge.removed via cleanup', () => {
      const addedListener = jest.fn();
      const removedListener = jest.fn();
      core.$systemEvents.on('bridge.added', addedListener);
      core.$systemEvents.on('bridge.removed', removedListener);

      const removeBridge = core.addBridge('cross-tab', {
        transport: {
          send: jest.fn(),
          onMessage: jest.fn(() => () => {}),
          destroy: jest.fn(),
        },
        forward: ['*'],
      });

      expect(addedListener).toHaveBeenCalledWith({ bridgeId: 'cross-tab' });
      expect(removedListener).not.toHaveBeenCalled();

      removeBridge();
      expect(removedListener).toHaveBeenCalledWith({ bridgeId: 'cross-tab' });
    });

    test('replacing a bridge with the same id emits bridge.removed then bridge.added', () => {
      const events: string[] = [];
      core.$systemEvents.on('bridge.added', () => events.push('added'));
      core.$systemEvents.on('bridge.removed', () => events.push('removed'));

      const makeTransport = () => ({
        send: jest.fn(),
        onMessage: jest.fn(() => () => {}),
        destroy: jest.fn(),
      });

      // Suppress the "already exists, replacing" warning.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      core.addBridge('cross-tab', { transport: makeTransport(), forward: ['*'] });
      core.addBridge('cross-tab', { transport: makeTransport(), forward: ['*'] });

      expect(events).toEqual(['added', 'removed', 'added']);
      warn.mockRestore();
    });
  });

  describe('lifecycle cleanup', () => {
    test('destroy() removes all system event listeners', () => {
      const listener = jest.fn();
      core.$systemEvents.on('client.registered', listener);
      expect(core.$systemEvents.listenerCount()).toBeGreaterThan(0);

      core.destroy();

      expect(core.$systemEvents.listenerCount()).toBe(0);
    });
  });
});
