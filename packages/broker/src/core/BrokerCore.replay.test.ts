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

// Helper to yield to the event loop. Replay itself is synchronous now (see
// "Replay ordering" below); this remains for tests that also involve timers
// or async handlers.
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

    test('records every multicast event by default — no flag at the emit site', async () => {
      const broker = createBrokerWithHistory();
      const client = new BrokerClient('test-client', broker);

      await client.emit('test.event.v1', { value: 1 });
      await client.emit('other.event.v1', { value: 2 });

      const topics = broker.inspect.getHistory().map((e) => e.message.topic);
      expect(topics).toEqual(['test.event.v1', 'other.event.v1']);
    });

    test('`history: false` keeps a message out of the buffer', async () => {
      const broker = createBrokerWithHistory();
      const client = new BrokerClient('test-client', broker);

      await client.emit('kept.v1', { value: 1 });
      await client.emit('noisy.v1', { value: 2 }, { history: false });
      await client.emit('kept.v1', { value: 3 });

      const topics = broker.inspect.getHistory().map((e) => e.message.topic);
      expect(topics).toEqual(['kept.v1', 'kept.v1']);
    });

    test('a late subscriber replays events that were emitted without any flag', async () => {
      const broker = createBrokerWithHistory();
      const producer = new BrokerClient('producer', broker);
      await producer.emit('feed.v1', { n: 1 });
      await producer.emit('feed.v1', { n: 2 });

      const seen: number[] = [];
      const late = new BrokerClient('late', broker);
      late.on('feed.v1', (msg) => seen.push((msg.data as { n: number }).n), { replay: { limit: 10 } });

      expect(seen).toEqual([1, 2]);
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

  describe('Replay ordering', () => {
    test('replayed entries are delivered before on() returns', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('event.v1', { id: 1 }, { history: true });
      await client1.emit('event.v1', { id: 2 }, { history: true });

      const handler = jest.fn();
      client2.on('event.v1', handler, { replay: { limit: 2 } });

      // No await, no flush — already delivered.
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls.map(([m]) => (m as Message).data.id)).toEqual([1, 2]);
      expect(handler.mock.calls.every(([m]) => (m as Message).replayed === true)).toBe(true);
    });

    test('a live message emitted right after on() arrives AFTER the replayed entries and is not duplicated', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('event.v1', { id: 1 }, { history: true });
      await client1.emit('event.v1', { id: 2 }, { history: true });
      await client1.emit('event.v1', { id: 3 }, { history: true });

      const seen: Array<{ id: number; replayed: boolean }> = [];
      client2.on(
        'event.v1',
        (m) => {
          seen.push({ id: m.data.id, replayed: m.replayed === true });
        },
        { replay: { limit: 3 } },
      );
      // Same tick as the subscription — this used to overtake the replay.
      const live = client1.emit('event.v1', { id: 4 }, { history: true });
      await live;
      await flushMicrotasks();

      expect(seen).toEqual([
        { id: 1, replayed: true },
        { id: 2, replayed: true },
        { id: 3, replayed: true },
        { id: 4, replayed: false },
      ]);
    });

    test('late-mount pattern: replay { limit: 1 } yields the latest snapshot exactly once even when a live update races', async () => {
      const broker = createBrokerWithHistory();
      const store = new BrokerClient('store', broker);
      const lateView = new BrokerClient('late-view', broker);

      await store.emit('event.v1', { id: 1 }, { history: true });
      await store.emit('event.v1', { id: 2 }, { history: true });

      const seen: Array<{ id: number; replayed: boolean }> = [];
      lateView.on(
        'event.v1',
        (m) => {
          seen.push({ id: m.data.id, replayed: m.replayed === true });
        },
        { replay: { limit: 1 } },
      );
      await store.emit('event.v1', { id: 3 }, { history: true });
      await flushMicrotasks();

      expect(seen).toEqual([
        { id: 2, replayed: true },
        { id: 3, replayed: false },
      ]);
    });

    test('a message emitted by a handler DURING replay is not itself replayed to that handler', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);
      const client3 = new BrokerClient('client3', broker);

      await client1.emit('event.v1', { id: 1 }, { history: true });

      const seenBy2: number[] = [];
      const seenBy3: number[] = [];
      client3.on('event.v1', (m) => seenBy3.push(m.data.id));
      client2.on(
        'event.v1',
        (m) => {
          seenBy2.push(m.data.id);
          // Re-entrant emit while replay is in progress.
          if (m.replayed) void client2.emit('event.v1', { id: 100 }, { history: true });
        },
        { replay: { limit: 10 } },
      );
      await flushMicrotasks();

      expect(seenBy2).toEqual([1]); // sender exclusion: client2 does not hear its own emit
      expect(seenBy3).toEqual([100]); // and the snapshot never grew to include id 100
    });

    test('an async handler that rejects during replay is logged, not left as an unhandled rejection', async () => {
      const logged: Array<Record<string, unknown> | undefined> = [];
      const broker = new BrokerCore({
        history: { enabled: true },
        logger: {
          warn: () => {},
          error: (event, meta) => {
            if (event === 'replay.handler.failed') logged.push(meta);
          },
        },
      });
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('event.v1', { id: 1 }, { history: true });

      client2.on('event.v1', async () => {
        throw new Error('async boom');
      }, { replay: { limit: 1 } });
      await flushMicrotasks();

      expect(logged).toHaveLength(1);
      expect(logged[0]).toEqual(
        expect.objectContaining({
          clientId: 'client2',
          topic: 'event.v1',
          messageId: expect.any(String),
          error: expect.any(Error),
        }),
      );
      broker.destroy();
    });

    test('afterSend observers see REPLAY_DELIVERED entries before the live one that follows', async () => {
      const broker = createBrokerWithHistory();
      const client1 = new BrokerClient('client1', broker);
      const client2 = new BrokerClient('client2', broker);

      await client1.emit('event.v1', { id: 1 }, { history: true });

      const feed: string[] = [];
      broker.useAfterSendHook((m, result) => {
        feed.push(`${m.data.id}:${result.reason}`);
      });

      client2.on('event.v1', () => {}, { replay: { limit: 1 } });
      await client1.emit('event.v1', { id: 2 });

      expect(feed).toEqual(['1:REPLAY_DELIVERED', '2:DISPATCHED']);
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
