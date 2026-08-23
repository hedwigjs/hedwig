import { SystemEvents } from './SystemEvents';
import { defaultLogger } from '../logger/BrokerLogger.types';

// Dummy topics: SystemEvents is generic over the broker's topic list only
// because `subscription.added.topic` is typed as `T`. The concrete values
// don't matter for the dispatcher — using neutral placeholders to avoid
// suggesting these tests are about any particular user/business feature.
type Topics = 'topic.a' | 'topic.b';
type Payloads = { 'topic.a': unknown; 'topic.b': unknown };

describe('SystemEvents', () => {
  let events: SystemEvents<Topics, Payloads>;

  beforeEach(() => {
    events = new SystemEvents<Topics, Payloads>(defaultLogger);
  });

  describe('on / emit', () => {
    test('listener receives matching event payload', () => {
      const listener = jest.fn();
      events.on('client.registered', listener);

      events.emit('client.registered', { clientId: 'c1', at: 123 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ clientId: 'c1', at: 123 });
    });

    test('listener does NOT receive events of other types', () => {
      const listener = jest.fn();
      events.on('client.registered', listener);

      events.emit('client.unregistered', { clientId: 'c1', at: 123 });

      expect(listener).not.toHaveBeenCalled();
    });

    test('multiple listeners all fire in registration order', () => {
      const order: string[] = [];
      events.on('client.registered', () => order.push('a'));
      events.on('client.registered', () => order.push('b'));
      events.on('client.registered', () => order.push('c'));

      events.emit('client.registered', { clientId: 'c1', at: 123 });

      expect(order).toEqual(['a', 'b', 'c']);
    });

    test('listener exception does not prevent other listeners from running', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const after = jest.fn();

      events.on('client.registered', () => {
        throw new Error('boom');
      });
      events.on('client.registered', after);

      events.emit('client.registered', { clientId: 'c1', at: 123 });

      expect(after).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    test('returned unsubscribe removes the listener', () => {
      const listener = jest.fn();
      const unsub = events.on('client.registered', listener);

      unsub();
      events.emit('client.registered', { clientId: 'c1', at: 123 });

      expect(listener).not.toHaveBeenCalled();
    });

    test('unsubscribing twice is a no-op', () => {
      const listener = jest.fn();
      const unsub = events.on('client.registered', listener);

      expect(() => {
        unsub();
        unsub();
      }).not.toThrow();
    });
  });

  describe('once', () => {
    test('listener fires exactly once and is auto-unsubscribed', () => {
      const listener = jest.fn();
      events.once('client.registered', listener);

      events.emit('client.registered', { clientId: 'c1', at: 1 });
      events.emit('client.registered', { clientId: 'c2', at: 2 });
      events.emit('client.registered', { clientId: 'c3', at: 3 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ clientId: 'c1', at: 1 });
    });

    test('returned unsubscribe cancels before first fire', () => {
      const listener = jest.fn();
      const unsub = events.once('client.registered', listener);

      unsub();
      events.emit('client.registered', { clientId: 'c1', at: 1 });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    test('removes listeners for a single event', () => {
      const a = jest.fn();
      const b = jest.fn();
      events.on('client.registered', a);
      events.on('subscription.added', b);

      events.off('client.registered');
      events.emit('client.registered', { clientId: 'c1', at: 1 });
      events.emit('subscription.added', { clientId: 'c1', topic: 'topic.a' });

      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });

    test('without arguments clears all per-event listeners', () => {
      const a = jest.fn();
      const b = jest.fn();
      events.on('client.registered', a);
      events.on('subscription.added', b);

      events.off();
      events.emit('client.registered', { clientId: 'c1', at: 1 });
      events.emit('subscription.added', { clientId: 'c1', topic: 'topic.a' });

      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    });
  });

  describe('onAny', () => {
    test('receives every event with its name', () => {
      const any = jest.fn();
      events.onAny(any);

      events.emit('client.registered', { clientId: 'c1', at: 1 });
      events.emit('subscription.added', { clientId: 'c1', topic: 'topic.a' });

      expect(any).toHaveBeenCalledTimes(2);
      expect(any).toHaveBeenNthCalledWith(1, 'client.registered', { clientId: 'c1', at: 1 });
      expect(any).toHaveBeenNthCalledWith(2, 'subscription.added', {
        clientId: 'c1',
        topic: 'topic.a',
      });
    });

    test('fires alongside typed listeners without duplicating', () => {
      const typed = jest.fn();
      const any = jest.fn();
      events.on('client.registered', typed);
      events.onAny(any);

      events.emit('client.registered', { clientId: 'c1', at: 1 });

      expect(typed).toHaveBeenCalledTimes(1);
      expect(any).toHaveBeenCalledTimes(1);
    });

    test('exception in any-listener does not affect typed listeners', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const typed = jest.fn();
      events.on('client.registered', typed);
      events.onAny(() => {
        throw new Error('boom');
      });

      events.emit('client.registered', { clientId: 'c1', at: 1 });

      expect(typed).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('listenerCount', () => {
    test('returns count for a specific event including any-listeners', () => {
      events.on('client.registered', () => {});
      events.on('client.registered', () => {});
      events.onAny(() => {});

      expect(events.listenerCount('client.registered')).toBe(3);
    });

    test('returns total count across all events when called without args', () => {
      events.on('client.registered', () => {});
      events.on('subscription.added', () => {});
      events.on('subscription.added', () => {});
      events.onAny(() => {});

      expect(events.listenerCount()).toBe(4);
    });

    test('returns 0 on a fresh instance', () => {
      expect(events.listenerCount()).toBe(0);
      expect(events.listenerCount('client.registered')).toBe(0);
    });
  });

  describe('fast path (no listeners)', () => {
    test('emit with no listeners at all is a no-op and does not throw', () => {
      expect(() => {
        events.emit('client.registered', { clientId: 'c1', at: 1 });
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    test('removes all listeners including any-listeners', () => {
      const typed = jest.fn();
      const any = jest.fn();
      events.on('client.registered', typed);
      events.onAny(any);

      events.clear();
      events.emit('client.registered', { clientId: 'c1', at: 1 });

      expect(typed).not.toHaveBeenCalled();
      expect(any).not.toHaveBeenCalled();
      expect(events.listenerCount()).toBe(0);
    });
  });
});
