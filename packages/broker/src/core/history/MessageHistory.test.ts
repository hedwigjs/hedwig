import { MessageHistory } from './MessageHistory';
import type { Message } from '../types';
import type { HistoryConfig } from './MessageHistory.types';

// Helper to create mock message
let mockCounter = 0;
const createMockEvent = (topic: string, source: string, data: any): Message<string, any> => ({
  id: `mock-${++mockCounter}`,
  topic,
  source,
  target: '*',
  data,
  timestamp: Date.now(),
});

// Helper for sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('MessageHistory', () => {
  let config: HistoryConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      maxSize: 100,
    };
  });

  describe('Constructor', () => {
    test('should create history with config', () => {
      const history = new MessageHistory(config);
      const stats = history.getStats();
      expect(stats.count).toBe(0);
    });

    test('should start TTL cleanup if configured', () => {
      jest.useFakeTimers();
      const configWithTTL: HistoryConfig = {
        ...config,
        ttl: 1000,
      };
      const history = new MessageHistory(configWithTTL);

      // Cleanup timer should be set
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      history.destroy();
      jest.useRealTimers();
    });
  });

  describe('record()', () => {
    test('should record event to history', () => {
      const history = new MessageHistory(config);
      const event = createMockEvent('user.login.v1', 'mfe-auth', { userId: '123' });

      history.record(event);

      const stats = history.getStats();
      expect(stats.count).toBe(1);
    });

    test('should record multiple events', () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'mfe-auth', {}));
      history.record(createMockEvent('user.logout.v1', 'mfe-auth', {}));
      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));

      const stats = history.getStats();
      expect(stats.count).toBe(3);
    });

    test('should freeze recorded events (immutability)', async () => {
      const history = new MessageHistory(config);
      const event = createMockEvent('test.v1', 'test', { value: 1 });

      history.record(event);

      const entries = await history.query();
      const storedEvent = entries[0].message;

      // Attempt to modify should throw or silently fail
      expect(() => {
        (storedEvent as any).topic = 'modified';
      }).toThrow();
    });

    test('should apply FIFO eviction when maxSize exceeded', () => {
      const smallConfig: HistoryConfig = {
        ...config,
        maxSize: 3,
      };
      const history = new MessageHistory(smallConfig);

      // Record 5 events (maxSize = 3)
      history.record(createMockEvent('event.1', 'test', { order: 1 }));
      history.record(createMockEvent('event.2', 'test', { order: 2 }));
      history.record(createMockEvent('event.3', 'test', { order: 3 }));
      history.record(createMockEvent('event.4', 'test', { order: 4 }));
      history.record(createMockEvent('event.5', 'test', { order: 5 }));

      const stats = history.getStats();
      expect(stats.count).toBe(3); // Should keep only last 3
    });

    test('should keep only newest events after FIFO eviction', async () => {
      const smallConfig: HistoryConfig = {
        ...config,
        maxSize: 2,
      };
      const history = new MessageHistory(smallConfig);

      history.record(createMockEvent('event.1', 'test', { order: 1 }));
      history.record(createMockEvent('event.2', 'test', { order: 2 }));
      history.record(createMockEvent('event.3', 'test', { order: 3 }));

      const entries = await history.query();
      expect(entries).toHaveLength(2);
      expect(entries[0].message.data.order).toBe(2); // event.1 evicted
      expect(entries[1].message.data.order).toBe(3);
    });

    test('should assign sequence numbers', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      history.record(createMockEvent('event.2', 'test', {}));
      history.record(createMockEvent('event.3', 'test', {}));

      const entries = await history.query();
      expect(entries[0].sequence).toBe(0);
      expect(entries[1].sequence).toBe(1);
      expect(entries[2].sequence).toBe(2);
    });
  });

  describe('query()', () => {
    test('should return all events when no filter', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'mfe-auth', {}));
      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));
      history.record(createMockEvent('user.logout.v1', 'mfe-auth', {}));

      const entries = await history.query();
      expect(entries).toHaveLength(3);
    });

    test('should return empty array when no events', async () => {
      const history = new MessageHistory(config);

      const entries = await history.query();
      expect(entries).toEqual([]);
    });

    test('should filter by exact event type', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'mfe-auth', {}));
      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));
      history.record(createMockEvent('user.logout.v1', 'mfe-auth', {}));

      const entries = await history.query({
        topics: ['cart.add.v1'],
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].message.topic).toBe('cart.add.v1');
    });

    test('should filter by glob pattern (wildcard at end)', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'mfe-auth', {}));
      history.record(createMockEvent('user.logout.v1', 'mfe-auth', {}));
      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));

      const entries = await history.query({
        topics: ['user.*'],
      });

      expect(entries).toHaveLength(2);
      expect(entries[0].message.topic).toBe('user.login.v1');
      expect(entries[1].message.topic).toBe('user.logout.v1');
    });

    test('should filter by glob pattern (wildcard in middle)', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));
      history.record(createMockEvent('cart.remove.v1', 'mfe-cart', {}));
      history.record(createMockEvent('cart.add.v2', 'mfe-cart', {}));

      const entries = await history.query({
        topics: ['cart.*.v1'],
      });

      expect(entries).toHaveLength(2);
      expect(entries[0].message.topic).toBe('cart.add.v1');
      expect(entries[1].message.topic).toBe('cart.remove.v1');
    });

    test('should filter by multiple event types', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'mfe-auth', {}));
      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));
      history.record(createMockEvent('notification.new.v1', 'mfe-notif', {}));

      const entries = await history.query({
        topics: ['user.login.v1', 'cart.add.v1'],
      });

      expect(entries).toHaveLength(2);
    });

    test('should filter by source', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.v1', 'mfe-auth', {}));
      history.record(createMockEvent('event.v1', 'mfe-cart', {}));
      history.record(createMockEvent('event.v1', 'mfe-auth', {}));

      const entries = await history.query({
        sources: ['mfe-auth'],
      });

      expect(entries).toHaveLength(2);
      expect(entries[0].message.source).toBe('mfe-auth');
      expect(entries[1].message.source).toBe('mfe-auth');
    });

    test('should filter by time range (since)', async () => {
      const history = new MessageHistory(config);
      const now = Date.now();

      history.record(createMockEvent('event.1', 'test', {}));
      await sleep(10);
      const midpoint = Date.now();
      await sleep(10);
      history.record(createMockEvent('event.2', 'test', {}));

      const entries = await history.query({
        since: midpoint,
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].message.topic).toBe('event.2');
    });

    test('should filter by time range (until)', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      await sleep(10);
      const midpoint = Date.now();
      await sleep(10);
      history.record(createMockEvent('event.2', 'test', {}));

      const entries = await history.query({
        until: midpoint,
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].message.topic).toBe('event.1');
    });

    test('should filter by time range (since + until)', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      await sleep(10);
      const start = Date.now();
      await sleep(10);
      history.record(createMockEvent('event.2', 'test', {}));
      await sleep(10);
      const end = Date.now();
      await sleep(10);
      history.record(createMockEvent('event.3', 'test', {}));

      const entries = await history.query({
        since: start,
        until: end,
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].message.topic).toBe('event.2');
    });

    test('should apply limit (last N events)', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      history.record(createMockEvent('event.2', 'test', {}));
      history.record(createMockEvent('event.3', 'test', {}));
      history.record(createMockEvent('event.4', 'test', {}));
      history.record(createMockEvent('event.5', 'test', {}));

      const entries = await history.query({ limit: 3 });

      expect(entries).toHaveLength(3);
      expect(entries[0].message.topic).toBe('event.3'); // Last 3
      expect(entries[1].message.topic).toBe('event.4');
      expect(entries[2].message.topic).toBe('event.5');
    });

    test('should combine multiple filters', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'mfe-auth', {}));
      await sleep(10);
      const since = Date.now();
      await sleep(10);
      history.record(createMockEvent('user.logout.v1', 'mfe-auth', {}));
      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));
      history.record(createMockEvent('user.update.v1', 'mfe-auth', {}));

      const entries = await history.query({
        topics: ['user.*'],
        sources: ['mfe-auth'],
        since: since,
        limit: 10,
      });

      expect(entries).toHaveLength(2); // user.logout + user.update
    });
  });

  describe('clear()', () => {
    test('should clear all events when no filter', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      history.record(createMockEvent('event.2', 'test', {}));
      history.record(createMockEvent('event.3', 'test', {}));

      await history.clear();

      const stats = history.getStats();
      expect(stats.count).toBe(0);
    });

    test('should clear filtered events by type', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'mfe-auth', {}));
      history.record(createMockEvent('cart.add.v1', 'mfe-cart', {}));
      history.record(createMockEvent('user.logout.v1', 'mfe-auth', {}));

      await history.clear({
        topics: ['user.*'],
      });

      const entries = await history.query();
      expect(entries).toHaveLength(1);
      expect(entries[0].message.topic).toBe('cart.add.v1');
    });

    test('should clear filtered events by source', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.v1', 'mfe-auth', {}));
      history.record(createMockEvent('event.v1', 'mfe-cart', {}));
      history.record(createMockEvent('event.v1', 'mfe-auth', {}));

      await history.clear({
        sources: ['mfe-auth'],
      });

      const entries = await history.query();
      expect(entries).toHaveLength(1);
      expect(entries[0].message.source).toBe('mfe-cart');
    });

    test('should clear filtered events by time range', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      await sleep(10);
      const cutoff = Date.now();
      await sleep(10);
      history.record(createMockEvent('event.2', 'test', {}));
      history.record(createMockEvent('event.3', 'test', {}));

      await history.clear({
        until: cutoff,
      });

      const entries = await history.query();
      expect(entries).toHaveLength(2);
      expect(entries[0].message.topic).toBe('event.2');
      expect(entries[1].message.topic).toBe('event.3');
    });
  });

  describe('getStats()', () => {
    test('should return zero stats for empty history', () => {
      const history = new MessageHistory(config);
      const stats = history.getStats();

      expect(stats.count).toBe(0);
      expect(stats.oldestTimestamp).toBeUndefined();
      expect(stats.newestTimestamp).toBeUndefined();
    });

    test('should return correct count', () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      history.record(createMockEvent('event.2', 'test', {}));
      history.record(createMockEvent('event.3', 'test', {}));

      const stats = history.getStats();
      expect(stats.count).toBe(3);
    });

    test('should return oldest and newest timestamps', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      await sleep(10);
      history.record(createMockEvent('event.2', 'test', {}));
      await sleep(10);
      history.record(createMockEvent('event.3', 'test', {}));

      const stats = history.getStats();
      expect(stats.oldestTimestamp).toBeDefined();
      expect(stats.newestTimestamp).toBeDefined();
      expect(stats.newestTimestamp!).toBeGreaterThan(stats.oldestTimestamp!);
    });

    test('should estimate memory usage', () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      history.record(createMockEvent('event.2', 'test', {}));

      const stats = history.getStats();
      expect(stats.memoryUsage).toBeDefined();
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.memoryUsage).toBeCloseTo(200, -2);
    });
  });

  describe('TTL cleanup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should automatically remove expired events', () => {
      const configWithTTL: HistoryConfig = {
        ...config,
        ttl: 1000, // 1 second TTL
      };
      const history = new MessageHistory(configWithTTL);

      // Record events
      history.record(createMockEvent('event.1', 'test', {}));
      history.record(createMockEvent('event.2', 'test', {}));

      expect(history.getStats().count).toBe(2);

      // Fast-forward past TTL + cleanup interval
      jest.advanceTimersByTime(1500);

      // Events should be cleaned up
      expect(history.getStats().count).toBe(0);

      history.destroy();
    });

    test('should not remove events within TTL', () => {
      const configWithTTL: HistoryConfig = {
        ...config,
        ttl: 5000, // 5 second TTL
      };
      const history = new MessageHistory(configWithTTL);

      history.record(createMockEvent('event.1', 'test', {}));

      // Fast-forward less than TTL
      jest.advanceTimersByTime(3000);

      expect(history.getStats().count).toBe(1);

      history.destroy();
    });
  });

  describe('destroy()', () => {
    test('should clear all events', () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('event.1', 'test', {}));
      history.record(createMockEvent('event.2', 'test', {}));

      history.destroy();

      const stats = history.getStats();
      expect(stats.count).toBe(0);
    });

    test('should stop TTL cleanup timer', () => {
      jest.useFakeTimers();
      const configWithTTL: HistoryConfig = {
        ...config,
        ttl: 1000,
      };
      const history = new MessageHistory(configWithTTL);

      const timersBefore = jest.getTimerCount();
      history.destroy();
      const timersAfter = jest.getTimerCount();

      expect(timersAfter).toBeLessThan(timersBefore);

      jest.useRealTimers();
    });
  });

  describe('Glob pattern matching', () => {
    test('should match exact string', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'test', {}));

      const entries = await history.query({
        topics: ['user.login.v1'],
      });

      expect(entries).toHaveLength(1);
    });

    test('should match wildcard at end', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'test', {}));
      history.record(createMockEvent('user.logout.v1', 'test', {}));
      history.record(createMockEvent('cart.add.v1', 'test', {}));

      const entries = await history.query({
        topics: ['user.*'],
      });

      expect(entries).toHaveLength(2);
    });

    test('should match wildcard at start', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'test', {}));
      history.record(createMockEvent('cart.add.v1', 'test', {}));
      history.record(createMockEvent('notification.new.v1', 'test', {}));

      const entries = await history.query({
        topics: ['*.v1'],
      });

      expect(entries).toHaveLength(3);
    });

    test('should match wildcard in middle', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'test', {}));
      history.record(createMockEvent('user.logout.v1', 'test', {}));
      history.record(createMockEvent('user.update.v2', 'test', {}));

      const entries = await history.query({
        topics: ['user.*.v1'],
      });

      expect(entries).toHaveLength(2);
    });

    test('should not match when pattern has no wildcard', async () => {
      const history = new MessageHistory(config);

      history.record(createMockEvent('user.login.v1', 'test', {}));
      history.record(createMockEvent('user.logout.v1', 'test', {}));

      const entries = await history.query({
        topics: ['user.login.v2'],
      });

      expect(entries).toHaveLength(0);
    });
  });
});
