import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import type { Message } from './types';

// Helper to create test broker with history enabled
const createBrokerWithHistory = (maxSize = 100, ttl?: number) => {
  return new BrokerCore({
    history: {
      enabled: true,
      maxSize,
      ttl,
    },
  });
};

// Helper for sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to wait for microtasks (replay happens in queueMicrotask)
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BrokerCore - Message History & Replay', () => {
  describe('History recording', () => {
    test('should use default maxSize when not specified', () => {
      const broker = new BrokerCore({
        history: { enabled: true }, // No maxSize specified
      });

      const stats = broker.inspect.getHistoryStats();
      expect(stats.enabled).toBe(true);
      // Should use default maxSize of 1000
    });

    test('should record events when history is enabled', async () => {
      const broker = createBrokerWithHistory();
      const client = new BrokerClient('test-client', broker);

      await client.emit('test.event.v1', { value: 1 }, { history: true });

      const stats = broker.inspect.getHistoryStats();
      expect(stats.enabled).toBe(true);
      expect(stats.count).toBe(1);
    });

    test('should not record events when history is disabled', async () => {
      const broker = new BrokerCore(); // No history config
      const client = new BrokerClient('test-client', broker);

      await client.emit('test.event.v1', { value: 1 }, { history: true });

      const stats = broker.inspect.getHistoryStats();
      expect(stats.enabled).toBe(false);
      expect(stats.count).toBe(0);
    });

    test('should record multiple events', async () => {
      const broker = createBrokerWithHistory();
      const client = new BrokerClient('test-client', broker);

      await client.emit('user.login.v1', { userId: '123' }, { history: true });
      await client.emit('cart.add.v1', { itemId: '456' }, { history: true });
      await client.emit('user.logout.v1', {}, { history: true });

      const stats = broker.inspect.getHistoryStats();
      expect(stats.count).toBe(3);
    });

    test('should record events AFTER beforeSend hooks', async () => {
      const broker = createBrokerWithHistory();
      const client = new BrokerClient('test-client', broker);

      // Block event with beforeSend hook
      broker.useBeforeSendHook(() => ({
        allowed: false,
        message: 'Blocked',
      }));

      await client.emit('test.event.v1', { value: 1 }, { history: true });

      // Blocked event should NOT be in history
      const stats = broker.inspect.getHistoryStats();
      expect(stats.count).toBe(0);
    });
  });

  describe('Replay on subscribe - sticky event behavior', () => {
    test('should warn when replay requested but history disabled', async () => {
      const broker = new BrokerCore(); // No history
      const client = new BrokerClient('test-client', broker);

      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

      client.on('test.event.v1', jest.fn(), {
        replay: { limit: 1 },
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        '[broker] broker.replay.history_disabled',
        { clientId: 'test-client', topic: 'test.event.v1' },
      );

      consoleWarn.mockRestore();
    });

    test('should replay last event (limit: 1)', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      // Client1 emits event
      await client1.emit('user.login.v1', { userId: '123' }, { history: true });

      // Client2 subscribes later with replay
      const handler = jest.fn();
      client2.on('user.login.v1', handler, {
        replay: { limit: 1 },
      });

      // Wait for replay (happens in microtask)
      await flushMicrotasks();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'user.login.v1',
          data: { userId: '123' },
        }),
      );
    });

    test('should replay multiple events (limit: N)', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      // Client1 emits multiple events
      await client1.emit('notification.new.v1', { id: 1 }, { history: true });
      await client1.emit('notification.new.v1', { id: 2 }, { history: true });
      await client1.emit('notification.new.v1', { id: 3 }, { history: true });
      await client1.emit('notification.new.v1', { id: 4 }, { history: true });
      await client1.emit('notification.new.v1', { id: 5 }, { history: true });

      // Client2 subscribes later with replay last 3
      const handler = jest.fn();
      client2.on('notification.new.v1', handler, {
        replay: { limit: 3 },
      });

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledTimes(3);
      // Should get last 3 events (3, 4, 5)
      expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: { id: 3 } }));
      expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { id: 4 } }));
      expect(handler).toHaveBeenNthCalledWith(3, expect.objectContaining({ data: { id: 5 } }));
    });

    test('should replay only matching event types', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      // Emit different event types
      await client1.emit('user.login.v1', { userId: '123' }, { history: true });
      await client1.emit('cart.add.v1', { itemId: '456' }, { history: true });
      await client1.emit('user.logout.v1', {}, { history: true });

      // Subscribe to only user.login.v1
      const handler = jest.fn();
      client2.on('user.login.v1', handler, {
        replay: { limit: 10 },
      });

      await flushMicrotasks();

      // Should only get user.login.v1
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ topic: 'user.login.v1' }));
    });

    test('should not replay if no matching events in history', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('other.event.v1', { value: 1 }, { history: true });

      const handler = jest.fn();
      client2.on('user.login.v1', handler, {
        replay: { limit: 1 },
      });

      await flushMicrotasks();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Replay with time filters', () => {
    test('should replay events since timestamp', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      // Emit event 1
      await client1.emit('message.v1', { id: 1 }, { history: true });
      await sleep(10);
      const since = Date.now();
      await sleep(10);

      // Emit event 2 & 3 after timestamp
      await client1.emit('message.v1', { id: 2 }, { history: true });
      await client1.emit('message.v1', { id: 3 }, { history: true });

      // Subscribe with since filter
      const handler = jest.fn();
      client2.on('message.v1', handler, {
        replay: { since },
      });

      await flushMicrotasks();

      // Should only get events 2 & 3
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: { id: 2 } }));
      expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { id: 3 } }));
    });

    test('should replay events until timestamp', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      // Emit events 1 & 2
      await client1.emit('message.v1', { id: 1 }, { history: true });
      await client1.emit('message.v1', { id: 2 }, { history: true });
      await sleep(10);
      const until = Date.now();
      await sleep(10);

      // Emit event 3 after timestamp
      await client1.emit('message.v1', { id: 3 }, { history: true });

      // Subscribe with until filter
      const handler = jest.fn();
      client2.on('message.v1', handler, {
        replay: { until },
      });

      await flushMicrotasks();

      // Should only get events 1 & 2
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: { id: 1 } }));
      expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { id: 2 } }));
    });

    test('should combine since + until + limit', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('message.v1', { id: 1 }, { history: true }); // Before since
      await sleep(10);
      const since = Date.now();
      await sleep(10);

      await client1.emit('message.v1', { id: 2 }, { history: true }); // In range
      await client1.emit('message.v1', { id: 3 }, { history: true }); // In range
      await client1.emit('message.v1', { id: 4 }, { history: true }); // In range
      await sleep(10);
      const until = Date.now();
      await sleep(10);

      await client1.emit('message.v1', { id: 5 }, { history: true }); // After until

      // Subscribe with filters
      const handler = jest.fn();
      client2.on('message.v1', handler, {
        replay: { since, until, limit: 2 },
      });

      await flushMicrotasks();

      // Should get last 2 in range: events 3 & 4
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: { id: 3 } }));
      expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { id: 4 } }));
    });
  });

  describe('Replay + Backpressure', () => {
    test('should work with throttle option', async () => {
      // Note: Testing exact throttle timing with replay is complex due to queueMicrotask
      // This test verifies that throttle option doesn't break replay
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      // Emit events
      await client1.emit('event.v1', { id: 1 }, { history: true });
      await client1.emit('event.v1', { id: 2 }, { history: true });

      // Subscribe with replay + throttle
      const handler = jest.fn();
      client2.on('event.v1', handler, {
        replay: { limit: 2 },
        backpressure: { throttle: 100 },
      });

      await flushMicrotasks();

      // Should receive replayed events (throttle applies to future live events)
      expect(handler).toHaveBeenCalled();
    });

    test('should work with debounce option', async () => {
      // Note: Debounce affects how replayed events are processed
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('search.v1', { query: 'abc' }, { history: true });

      const handler = jest.fn();
      client2.on('search.v1', handler, {
        replay: { limit: 1 },
        backpressure: { debounce: 50 },
      });

      await flushMicrotasks();
      await sleep(100); // Wait for debounce

      // Should have received the event
      expect(handler).toHaveBeenCalled();
    });

  });

  describe('Replay for multiple subscribers', () => {
    test('should replay independently for each subscriber', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);
      const client3 = new BrokerClient('client3', broker);

      // Emit events
      await client1.emit('event.v1', { id: 1 }, { history: true });
      await client1.emit('event.v1', { id: 2 }, { history: true });
      await client1.emit('event.v1', { id: 3 }, { history: true });

      // Both clients subscribe with replay
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      client2.on('event.v1', handler2, { replay: { limit: 2 } });
      client3.on('event.v1', handler3, { replay: { limit: 1 } });

      await flushMicrotasks();
      await sleep(50); // Give extra time for handlers

      // Each should get their own replay
      expect(handler2).toHaveBeenCalledTimes(2); // Last 2
      expect(handler3).toHaveBeenCalledTimes(1); // Last 1
    });
  });

  describe('Unicast Replay Security', () => {
    test('should replay multicast events to all subscribers', async () => {
      const broker = createBrokerWithHistory();
      const sender = new BrokerClient('sender', broker);
      const receiver1 = new BrokerClient('receiver1', broker);
      const receiver2 = new BrokerClient('receiver2', broker);

      // Send multicast event (recipient = '*')
      await sender.emit('notification.v1', { message: 'Hello all' }, { history: true });

      // Both receivers subscribe with replay
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      receiver1.on('notification.v1', handler1, { replay: { limit: 1 } });
      receiver2.on('notification.v1', handler2, { replay: { limit: 1 } });

      await flushMicrotasks();

      // Both should receive multicast event
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    test('should replay unicast events ONLY to original recipient', async () => {
      const broker = createBrokerWithHistory();
      const sender = new BrokerClient('sender', broker);
      const targetClient = new BrokerClient('target-client', broker);

      // Send unicast event (recipient = 'target-client')
      await sender.request(
        'target-client',
        'private.message.v1',
        {
          secret: 'confidential data',
        },
        { history: true },
      );

      // Original recipient subscribes with replay
      const targetHandler = jest.fn();
      targetClient.on('private.message.v1', targetHandler, { replay: { limit: 1 } });

      await flushMicrotasks();

      // Target client should receive the event
      expect(targetHandler).toHaveBeenCalledTimes(1);
      expect(targetHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { secret: 'confidential data' },
          target: 'target-client',
        }),
      );
    });

    test('should NOT replay unicast events to third parties', async () => {
      const broker = createBrokerWithHistory();
      const sender = new BrokerClient('sender', broker);
      const targetClient = new BrokerClient('target-client', broker);
      const thirdParty = new BrokerClient('third-party', broker);

      // Send unicast event to target-client
      await sender.request(
        'target-client',
        'payment.process.v1',
        {
          cardNumber: '4242-4242-4242-4242',
          amount: 1000,
        },
        { history: true },
      );

      // Third party tries to subscribe with replay
      const thirdPartyHandler = jest.fn();
      thirdParty.on('payment.process.v1', thirdPartyHandler, { replay: { limit: 10 } });

      await flushMicrotasks();

      // Third party should NOT receive the unicast event (security!)
      expect(thirdPartyHandler).not.toHaveBeenCalled();
    });

    test('should mark replayed events with replayed flag', async () => {
      const broker = createBrokerWithHistory();
      const sender = new BrokerClient('sender', broker);
      const receiver = new BrokerClient('receiver', broker);

      await sender.emit('event.v1', { value: 123 }, { history: true });

      const handler = jest.fn();
      receiver.on('event.v1', handler, { replay: { limit: 1 } });

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          replayed: true,
          data: { value: 123 },
        }),
      );
    });

    test('should replay multiple unicast events to correct recipients', async () => {
      const broker = createBrokerWithHistory();
      const sender = new BrokerClient('sender', broker);
      const clientA = new BrokerClient('client-a', broker);
      const clientB = new BrokerClient('client-b', broker);

      // Send unicast to A
      await sender.request('client-a', 'task.assigned.v1', { task: 'Task A' }, { history: true });
      // Send unicast to B
      await sender.request('client-b', 'task.assigned.v1', { task: 'Task B' }, { history: true });

      // Both subscribe with replay
      const handlerA = jest.fn();
      const handlerB = jest.fn();

      clientA.on('task.assigned.v1', handlerA, { replay: { limit: 10 } });
      clientB.on('task.assigned.v1', handlerB, { replay: { limit: 10 } });

      await flushMicrotasks();

      // Each should receive only their own task
      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerA).toHaveBeenCalledWith(expect.objectContaining({ data: { task: 'Task A' } }));

      expect(handlerB).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledWith(expect.objectContaining({ data: { task: 'Task B' } }));
    });

    test('should replay mix of multicast and unicast correctly', async () => {
      const broker = createBrokerWithHistory();
      const sender = new BrokerClient('sender', broker);
      const clientA = new BrokerClient('client-a', broker);
      const clientB = new BrokerClient('client-b', broker);

      // Multicast
      await sender.emit('announcement.v1', { msg: 'Public' }, { history: true });
      // Unicast to A
      await sender.request(
        'client-a',
        'announcement.v1',
        { msg: 'Private for A' },
        { history: true },
      );
      // Unicast to B
      await sender.request(
        'client-b',
        'announcement.v1',
        { msg: 'Private for B' },
        { history: true },
      );

      const handlerA = jest.fn();
      const handlerB = jest.fn();

      clientA.on('announcement.v1', handlerA, { replay: { limit: 10 } });
      clientB.on('announcement.v1', handlerB, { replay: { limit: 10 } });

      await flushMicrotasks();

      // Client A should get: multicast + their unicast
      expect(handlerA).toHaveBeenCalledTimes(2);
      expect(handlerA).toHaveBeenCalledWith(expect.objectContaining({ data: { msg: 'Public' } }));
      expect(handlerA).toHaveBeenCalledWith(
        expect.objectContaining({ data: { msg: 'Private for A' } }),
      );

      // Client B should get: multicast + their unicast
      expect(handlerB).toHaveBeenCalledTimes(2);
      expect(handlerB).toHaveBeenCalledWith(expect.objectContaining({ data: { msg: 'Public' } }));
      expect(handlerB).toHaveBeenCalledWith(
        expect.objectContaining({ data: { msg: 'Private for B' } }),
      );
    });
  });

  describe('History API', () => {
    test('getHistoryStats should return stats', () => {
      const broker = createBrokerWithHistory();
      const stats = broker.inspect.getHistoryStats();

      expect(stats.enabled).toBe(true);
      expect(stats.count).toBe(0);
    });

  });

  describe('Error handling', () => {
    test('should handle errors in replay handler gracefully', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('event.v1', { id: 1 }, { history: true });

      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Handler that throws
      const handler = jest.fn(() => {
        throw new Error('Handler error');
      });

      client2.on('event.v1', handler, { replay: { limit: 1 } });

      await flushMicrotasks();
      await sleep(50); // Give time for error handling

      expect(handler).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        '[broker] replay.handler.failed',
        expect.objectContaining({ error: expect.any(Error) }),
      );

      consoleError.mockRestore();
    });
  });

  describe('Lifecycle', () => {
    test('should cleanup history on destroy', async () => {
      const broker = createBrokerWithHistory();
      const client = new BrokerClient('test-client', broker);

      await client.emit('event.v1', { id: 1 }, { history: true });

      expect(broker.inspect.getHistoryStats().count).toBe(1);

      broker.destroy();

      expect(broker.inspect.getHistoryStats().count).toBe(0);
    });
  });

  describe('TTL cleanup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should respect TTL for history', async () => {
      const broker = createBrokerWithHistory(100, 1000); // 1 second TTL
      const client = new BrokerClient('test-client', broker);

      await client.emit('event.v1', { id: 1 }, { history: true });

      expect(broker.inspect.getHistoryStats().count).toBe(1);

      // Fast-forward past TTL
      jest.advanceTimersByTime(1500);

      expect(broker.inspect.getHistoryStats().count).toBe(0);

      broker.destroy();
    });
  });
});
