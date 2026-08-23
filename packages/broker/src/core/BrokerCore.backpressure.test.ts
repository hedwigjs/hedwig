import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import type { Message } from './types';

type TestEventType =
  | 'stock.price.v1'
  | 'search.query.v1'
  | 'notification.new.v1'
  | 'analytics.track.v1';
type TestEventPayloads = {
  'stock.price.v1': { symbol: string; price: number };
  'search.query.v1': { query: string };
  'notification.new.v1': { message: string };
  'analytics.track.v1': { event: string };
};

/**
 * Integration Tests for Backpressure Features
 *
 * Tests the full integration of backpressure strategies with BrokerCore:
 * 1. Throttle - Rate limiting with guaranteed last event
 * 2. Debounce - Delay until silence
 * 3. Rate Limit - Hard limit with event dropping
 *
 * These tests verify end-to-end behavior through the Client → BrokerCore → Strategy pipeline.
 */
describe('BrokerCore - Backpressure Integration', () => {
  let core: BrokerCore<TestEventType, TestEventPayloads>;

  beforeEach(() => {
    core = new BrokerCore<TestEventType, TestEventPayloads>();
  });

  afterEach(() => {
    core.destroy();
  });

  // ========================================
  // 1. THROTTLE INTEGRATION
  // ========================================

  describe('Throttle Integration', () => {
    test('should throttle high-frequency events', async () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('price-feed', core);
      const receiver = new BrokerClient('chart-widget', core);

      const handlerCalls: number[] = [];

      // Subscribe with 100ms throttle
      receiver.on(
        'stock.price.v1',
        (event) => {
          handlerCalls.push(event.data.price);
        },
        { backpressure: { throttle: 100 } },
      );

      // Send 5 events rapidly (within 100ms)
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 100 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 101 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 102 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 103 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 104 });

      // First call should execute immediately
      expect(handlerCalls).toEqual([100]);

      // Fast-forward 100ms - should execute last pending (104)
      jest.advanceTimersByTime(100);
      expect(handlerCalls).toEqual([100, 104]);

      // Send more events - 105 is delayed because 104 just executed
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 105 });
      expect(handlerCalls).toEqual([100, 104]); // Still throttled

      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 106 });
      jest.advanceTimersByTime(100);
      expect(handlerCalls).toEqual([100, 104, 106]); // Last pending executed

      jest.useRealTimers();
    });

    test('should flush throttled events on unsubscribe', () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: number[] = [];

      const unsubscribe = receiver.on(
        'stock.price.v1',
        (event) => {
          handlerCalls.push(event.data.price);
        },
        { backpressure: { throttle: 100 } },
      );

      // First event executes immediately
      sender.emit('stock.price.v1', { symbol: 'AAPL', price: 100 });
      expect(handlerCalls).toEqual([100]);

      // Second event is pending
      sender.emit('stock.price.v1', { symbol: 'AAPL', price: 101 });
      expect(handlerCalls).toEqual([100]); // Still pending

      // Unsubscribe should flush pending event
      unsubscribe();
      expect(handlerCalls).toEqual([100, 101]); // Flushed!

      jest.useRealTimers();
    });

    test('should work with unicast (request)', async () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: number[] = [];

      receiver.on(
        'stock.price.v1',
        (event) => {
          handlerCalls.push(event.data.price);
        },
        { backpressure: { throttle: 50 } },
      );

      // Send via request (unicast)
      await sender.request('receiver', 'stock.price.v1', { symbol: 'AAPL', price: 100 });
      await sender.request('receiver', 'stock.price.v1', { symbol: 'AAPL', price: 101 });
      await sender.request('receiver', 'stock.price.v1', { symbol: 'AAPL', price: 102 });

      expect(handlerCalls).toEqual([100]); // First only

      jest.advanceTimersByTime(50);
      expect(handlerCalls).toEqual([100, 102]); // Last pending

      jest.useRealTimers();
    });
  });

  // ========================================
  // 2. DEBOUNCE INTEGRATION
  // ========================================

  describe('Debounce Integration', () => {
    test('should debounce search queries', async () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('search-input', core);
      const receiver = new BrokerClient('search-service', core);

      const handlerCalls: string[] = [];

      // Subscribe with 300ms debounce
      receiver.on(
        'search.query.v1',
        (event) => {
          handlerCalls.push(event.data.query);
        },
        { backpressure: { debounce: 300 } },
      );

      // Type: "r" → "re" → "rea" → "reac" → "react"
      await sender.emit('search.query.v1', { query: 'r' });
      jest.advanceTimersByTime(100);

      await sender.emit('search.query.v1', { query: 're' });
      jest.advanceTimersByTime(100);

      await sender.emit('search.query.v1', { query: 'rea' });
      jest.advanceTimersByTime(100);

      await sender.emit('search.query.v1', { query: 'reac' });
      jest.advanceTimersByTime(100);

      await sender.emit('search.query.v1', { query: 'react' });

      // No calls yet (still debouncing)
      expect(handlerCalls).toEqual([]);

      // Wait 300ms - should execute last query
      jest.advanceTimersByTime(300);
      expect(handlerCalls).toEqual(['react']);

      jest.useRealTimers();
    });

    test('should reset debounce timer on each event', () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: string[] = [];

      receiver.on(
        'search.query.v1',
        (event) => {
          handlerCalls.push(event.data.query);
        },
        { backpressure: { debounce: 200 } },
      );

      // Event 1
      sender.emit('search.query.v1', { query: 'a' });
      jest.advanceTimersByTime(150); // 150ms elapsed

      // Event 2 - resets timer!
      sender.emit('search.query.v1', { query: 'ab' });
      jest.advanceTimersByTime(150); // 150ms more (total 300ms from event1)

      // Still no calls (timer was reset)
      expect(handlerCalls).toEqual([]);

      // Wait 50ms more (200ms from event2)
      jest.advanceTimersByTime(50);
      expect(handlerCalls).toEqual(['ab']);

      jest.useRealTimers();
    });

    test('should flush debounced event on unsubscribe', () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: string[] = [];

      const unsubscribe = receiver.on(
        'search.query.v1',
        (event) => {
          handlerCalls.push(event.data.query);
        },
        { backpressure: { debounce: 300 } },
      );

      sender.emit('search.query.v1', { query: 'pending' });
      expect(handlerCalls).toEqual([]); // Still pending

      // Unsubscribe should flush pending event
      unsubscribe();
      expect(handlerCalls).toEqual(['pending']); // Flushed!

      jest.useRealTimers();
    });

    test('should execute only once after silence', () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: string[] = [];

      receiver.on(
        'search.query.v1',
        (event) => {
          handlerCalls.push(event.data.query);
        },
        { backpressure: { debounce: 100 } },
      );

      // Rapid fire
      sender.emit('search.query.v1', { query: 'a' });
      sender.emit('search.query.v1', { query: 'ab' });
      sender.emit('search.query.v1', { query: 'abc' });

      jest.advanceTimersByTime(100);

      // Only last one executed
      expect(handlerCalls).toEqual(['abc']);

      jest.useRealTimers();
    });
  });

  // ========================================
  // 3. RATE LIMIT INTEGRATION
  // ========================================

  describe('Rate Limit Integration', () => {
    test('should drop events exceeding rate limit', async () => {
      const sender = new BrokerClient('analytics-tracker', core);
      const receiver = new BrokerClient('analytics-service', core);

      const handlerCalls: string[] = [];
      const droppedCounts: number[] = [];

      // Rate limit: max 3 events per 1000ms
      receiver.on(
        'analytics.track.v1',
        (event) => {
          handlerCalls.push(event.data.event);
        },
        {
          backpressure: {
            rateLimit: { max: 3, window: 1000 },
            onDrop: (count: number) => {
              droppedCounts.push(count);
            },
          },
        },
      );

      // Send 5 events (exceeds limit of 3)
      await sender.emit('analytics.track.v1', { event: 'event1' });
      await sender.emit('analytics.track.v1', { event: 'event2' });
      await sender.emit('analytics.track.v1', { event: 'event3' });
      await sender.emit('analytics.track.v1', { event: 'event4' }); // DROPPED
      await sender.emit('analytics.track.v1', { event: 'event5' }); // DROPPED

      // Only first 3 processed
      expect(handlerCalls).toEqual(['event1', 'event2', 'event3']);

      // onDrop callbacks called
      expect(droppedCounts.length).toBeGreaterThan(0);
    });

    test('should reset rate limit after window expires', async () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: string[] = [];

      receiver.on(
        'analytics.track.v1',
        (event) => {
          handlerCalls.push(event.data.event);
        },
        { backpressure: { rateLimit: { max: 2, window: 500 } } },
      );

      // Window 1: send 3 events (limit = 2)
      await sender.emit('analytics.track.v1', { event: 'event1' });
      await sender.emit('analytics.track.v1', { event: 'event2' });
      await sender.emit('analytics.track.v1', { event: 'event3' }); // DROPPED

      expect(handlerCalls).toEqual(['event1', 'event2']);

      // Wait for window to expire
      jest.advanceTimersByTime(500);

      // Window 2: send 2 more events (should work)
      await sender.emit('analytics.track.v1', { event: 'event4' });
      await sender.emit('analytics.track.v1', { event: 'event5' });

      expect(handlerCalls).toEqual(['event1', 'event2', 'event4', 'event5']);

      jest.useRealTimers();
    });

    test('should call onDrop callback with correct count', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const dropCallback = jest.fn();

      receiver.on('analytics.track.v1', jest.fn(), {
        backpressure: {
          rateLimit: { max: 2, window: 1000 },
          onDrop: dropCallback,
        },
      });

      // Send 5 events (3 dropped)
      await sender.emit('analytics.track.v1', { event: 'event1' });
      await sender.emit('analytics.track.v1', { event: 'event2' });
      await sender.emit('analytics.track.v1', { event: 'event3' }); // drop 1
      await sender.emit('analytics.track.v1', { event: 'event4' }); // drop 2
      await sender.emit('analytics.track.v1', { event: 'event5' }); // drop 3

      // Callback should be called with cumulative count
      expect(dropCallback).toHaveBeenCalled();
      const calls = dropCallback.mock.calls.map((call) => call[0]);
      expect(calls).toEqual([1, 2, 3]); // Cumulative counts
    });

    test('should work with unicast (request)', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: string[] = [];

      receiver.on(
        'analytics.track.v1',
        (event) => {
          handlerCalls.push(event.data.event);
        },
        { backpressure: { rateLimit: { max: 2, window: 1000 } } },
      );

      // Send via request
      await sender.request('receiver', 'analytics.track.v1', { event: 'event1' });
      await sender.request('receiver', 'analytics.track.v1', { event: 'event2' });
      await sender.request('receiver', 'analytics.track.v1', { event: 'event3' }); // DROPPED

      expect(handlerCalls).toEqual(['event1', 'event2']);
    });
  });

  // ========================================
  // 4. EDGE CASES & CLEANUP
  // ========================================

  describe('Backpressure Edge Cases', () => {
    test('should work without backpressure options (backward compatibility)', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: number[] = [];

      // No options - normal behavior
      receiver.on('stock.price.v1', (event) => {
        handlerCalls.push(event.data.price);
      });

      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 100 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 101 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 102 });

      // All events processed immediately
      expect(handlerCalls).toEqual([100, 101, 102]);
    });

    test('should cleanup strategies on broker destroy', () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: string[] = [];

      receiver.on(
        'search.query.v1',
        (event) => {
          handlerCalls.push(event.data.query);
        },
        { backpressure: { debounce: 300 } },
      );

      sender.emit('search.query.v1', { query: 'pending' });
      expect(handlerCalls).toEqual([]); // Pending

      // Destroy broker
      core.destroy();

      // Pending events should be flushed
      expect(handlerCalls).toEqual(['pending']);

      jest.useRealTimers();
    });

    test('should handle multiple clients with different backpressure options', async () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver1 = new BrokerClient('receiver1', core);
      const receiver2 = new BrokerClient('receiver2', core);
      const receiver3 = new BrokerClient('receiver3', core);

      const calls1: number[] = [];
      const calls2: number[] = [];
      const calls3: number[] = [];

      // Different strategies
      receiver1.on('stock.price.v1', (e) => calls1.push(e.data.price), {
        backpressure: { throttle: 100 },
      });
      receiver2.on('stock.price.v1', (e) => calls2.push(e.data.price), {
        backpressure: { debounce: 200 },
      });
      receiver3.on('stock.price.v1', (e) => calls3.push(e.data.price)); // No backpressure

      // Send events
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 100 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 101 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 102 });

      // receiver1: throttled (first only)
      expect(calls1).toEqual([100]);

      // receiver2: debouncing (none yet)
      expect(calls2).toEqual([]);

      // receiver3: all events
      expect(calls3).toEqual([100, 101, 102]);

      // Advance time
      jest.advanceTimersByTime(100);
      expect(calls1).toEqual([100, 102]); // Throttle flushed

      jest.advanceTimersByTime(100);
      expect(calls2).toEqual([102]); // Debounce flushed

      jest.useRealTimers();
    });

    test('should handle async handlers with backpressure', async () => {
      jest.useFakeTimers();

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handlerCalls: number[] = [];

      receiver.on(
        'stock.price.v1',
        async (event) => {
          // Simulate async work
          await Promise.resolve();
          handlerCalls.push(event.data.price);
        },
        { backpressure: { throttle: 100 } },
      );

      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 100 });
      await sender.emit('stock.price.v1', { symbol: 'AAPL', price: 101 });

      // First call executes
      expect(handlerCalls).toEqual([100]);

      jest.advanceTimersByTime(100);

      // Wait for promises to resolve
      await Promise.resolve();

      expect(handlerCalls).toEqual([100, 101]);

      jest.useRealTimers();
    });
  });
});
