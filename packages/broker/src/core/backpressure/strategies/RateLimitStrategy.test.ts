import { RateLimitStrategy } from './RateLimitStrategy';
import { defaultLogger } from '../../logger/BrokerLogger.types';
import type { Message } from '../../types';

// Helper to create mock message
const createMockMessage = (data: any): Message<string, any> => ({
  topic: 'test.event.v1',
  source: 'test',
  id: Math.random().toString(36),
  timestamp: Date.now(),
  data,
  target: '*',
});

// Helper for sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RateLimitStrategy', () => {
  describe('Constructor', () => {
    test('should create strategy with valid options', () => {
      expect(() => new RateLimitStrategy({ max: 100, window: 1000 }, undefined, defaultLogger)).not.toThrow();
    });

    test('should throw error for invalid max', () => {
      expect(() => new RateLimitStrategy({ max: 0, window: 1000 }, undefined, defaultLogger)).toThrow(
        'Rate limit max must be positive',
      );
      expect(() => new RateLimitStrategy({ max: -10, window: 1000 }, undefined, defaultLogger)).toThrow(
        'Rate limit max must be positive',
      );
    });

    test('should throw error for invalid window', () => {
      expect(() => new RateLimitStrategy({ max: 100, window: 0 }, undefined, defaultLogger)).toThrow(
        'Rate limit window must be positive',
      );
      expect(() => new RateLimitStrategy({ max: 100, window: -100 }, undefined, defaultLogger)).toThrow(
        'Rate limit window must be positive',
      );
    });

    test('should throw error for non-number values', () => {
      expect(() => new RateLimitStrategy({ max: undefined as any, window: 1000 }, undefined, defaultLogger)).toThrow(
        'Rate limit max must be a finite number',
      );
      expect(() => new RateLimitStrategy({ max: 100, window: undefined as any }, undefined, defaultLogger)).toThrow(
        'Rate limit window must be a finite number',
      );
      expect(() => new RateLimitStrategy({ max: NaN, window: 1000 }, undefined, defaultLogger)).toThrow(
        'Rate limit max must be a finite number',
      );
      expect(() => new RateLimitStrategy({ max: 100, window: NaN }, undefined, defaultLogger)).toThrow(
        'Rate limit window must be a finite number',
      );
      expect(() => new RateLimitStrategy({ max: Infinity, window: 1000 }, undefined, defaultLogger)).toThrow(
        'Rate limit max must be a finite number',
      );
      expect(() => new RateLimitStrategy({ max: 100, window: Infinity }, undefined, defaultLogger)).toThrow(
        'Rate limit window must be a finite number',
      );
    });

    test('should throw error for empty object', () => {
      expect(() => new RateLimitStrategy({} as any, undefined, defaultLogger)).toThrow('must be a finite number');
    });

    test('should throw error for partial object - only max', () => {
      expect(() => new RateLimitStrategy({ max: 100 } as any, undefined, defaultLogger)).toThrow(
        'Rate limit window must be a finite number',
      );
    });

    test('should throw error for partial object - only window', () => {
      expect(() => new RateLimitStrategy({ window: 1000 } as any, undefined, defaultLogger)).toThrow(
        'Rate limit max must be a finite number',
      );
    });
  });

  describe('Process - Under Limit', () => {
    test('should allow events under limit', () => {
      const strategy = new RateLimitStrategy({ max: 5, window: 1000 }, undefined, defaultLogger);
      const handler = jest.fn();

      for (let i = 0; i < 5; i++) {
        const result = strategy.process(createMockMessage({ value: i }), handler);
        expect(result).toBe(true); // Allowed
      }

      expect(handler).toHaveBeenCalledTimes(5);
      expect(strategy.droppedCount).toBe(0);
    });

    test('should track current count correctly', () => {
      const strategy = new RateLimitStrategy({ max: 10, window: 1000 }, undefined, defaultLogger);
      const handler = jest.fn();

      expect(strategy.currentCount).toBe(0);

      strategy.process(createMockMessage({ value: 1 }), handler);
      expect(strategy.currentCount).toBe(1);

      strategy.process(createMockMessage({ value: 2 }), handler);
      expect(strategy.currentCount).toBe(2);
    });
  });

  describe('Process - Over Limit', () => {
    test('should drop events over limit', () => {
      const strategy = new RateLimitStrategy({ max: 5, window: 1000 }, undefined, defaultLogger);
      const handler = jest.fn();

      // Fill up to limit
      for (let i = 0; i < 5; i++) {
        strategy.process(createMockMessage({ value: i }), handler);
      }

      // Exceed limit
      const result = strategy.process(createMockMessage({ value: 5 }), handler);

      expect(result).toBe(false); // Dropped
      expect(handler).toHaveBeenCalledTimes(5); // Only first 5
      expect(strategy.droppedCount).toBe(1);
    });

    test('should call onDrop callback', () => {
      const onDrop = jest.fn();
      const strategy = new RateLimitStrategy({ max: 3, window: 1000 }, onDrop, defaultLogger);
      const handler = jest.fn();

      // Fill to limit
      for (let i = 0; i < 3; i++) {
        strategy.process(createMockMessage({ value: i }), handler);
      }

      expect(onDrop).not.toHaveBeenCalled();

      // Drop events
      strategy.process(createMockMessage({ value: 3 }), handler);
      expect(onDrop).toHaveBeenCalledWith(1);

      strategy.process(createMockMessage({ value: 4 }), handler);
      expect(onDrop).toHaveBeenCalledWith(2);

      strategy.process(createMockMessage({ value: 5 }), handler);
      expect(onDrop).toHaveBeenCalledWith(3);
    });

    test('should track dropped count', () => {
      const strategy = new RateLimitStrategy({ max: 2, window: 1000 }, undefined, defaultLogger);
      const handler = jest.fn();

      strategy.process(createMockMessage({ value: 1 }), handler);
      strategy.process(createMockMessage({ value: 2 }), handler);

      expect(strategy.droppedCount).toBe(0);

      strategy.process(createMockMessage({ value: 3 }), handler);
      strategy.process(createMockMessage({ value: 4 }), handler);

      expect(strategy.droppedCount).toBe(2);
    });
  });

  describe('Sliding Window', () => {
    test('should allow events after window expires', async () => {
      jest.useRealTimers();

      const strategy = new RateLimitStrategy({ max: 2, window: 100 }, undefined, defaultLogger);
      const handler = jest.fn();

      // Fill limit
      strategy.process(createMockMessage({ value: 1 }), handler);
      strategy.process(createMockMessage({ value: 2 }), handler);

      // Should drop
      let result = strategy.process(createMockMessage({ value: 3 }), handler);
      expect(result).toBe(false);
      expect(handler).toHaveBeenCalledTimes(2);

      // Wait for window to expire
      await sleep(110);

      // Should allow again
      result = strategy.process(createMockMessage({ value: 4 }), handler);
      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    test('should implement true sliding window (not fixed window)', async () => {
      jest.useRealTimers();

      const strategy = new RateLimitStrategy({ max: 2, window: 100 }, undefined, defaultLogger);
      const handler = jest.fn();

      // Event 1 at t=0
      strategy.process(createMockMessage({ value: 1 }), handler);

      // Event 2 at t=50
      await sleep(50);
      strategy.process(createMockMessage({ value: 2 }), handler);

      // Event 3 at t=60 (should drop: 2 events in last 100ms)
      await sleep(10);
      let result = strategy.process(createMockMessage({ value: 3 }), handler);
      expect(result).toBe(false);

      // Event 4 at t=110 (should allow: event 1 expired)
      await sleep(50);
      result = strategy.process(createMockMessage({ value: 4 }), handler);
      expect(result).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle handler errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const strategy = new RateLimitStrategy({ max: 5, window: 1000 }, undefined, defaultLogger);
      const handler = jest.fn(() => {
        throw new Error('Handler error');
      });

      const result = strategy.process(createMockMessage({ value: 1 }), handler);

      expect(result).toBe(true); // Still processed (error in handler, not strategy)
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    test('should handle onDrop errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const onDrop = jest.fn(() => {
        throw new Error('onDrop error');
      });
      const strategy = new RateLimitStrategy({ max: 1, window: 1000 }, onDrop, defaultLogger);
      const handler = jest.fn();

      strategy.process(createMockMessage({ value: 1 }), handler);
      strategy.process(createMockMessage({ value: 2 }), handler); // Should drop

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(strategy.droppedCount).toBe(1); // Still tracked

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Flush', () => {
    test('should be no-op (rate limit does not buffer)', () => {
      const strategy = new RateLimitStrategy({ max: 5, window: 1000 }, undefined, defaultLogger);
      const handler = jest.fn();

      strategy.process(createMockMessage({ value: 1 }), handler);

      expect(() => strategy.flush()).not.toThrow();
      expect(handler).toHaveBeenCalledTimes(1); // No additional calls
    });
  });

  describe('Destroy', () => {
    test('should clear timestamps on destroy', () => {
      const strategy = new RateLimitStrategy({ max: 5, window: 1000 }, undefined, defaultLogger);
      const handler = jest.fn();

      strategy.process(createMockMessage({ value: 1 }), handler);
      expect(strategy.currentCount).toBe(1);

      strategy.destroy();

      expect(strategy.currentCount).toBe(0);
    });
  });

  describe('Real-world scenarios', () => {
    test('should protect from spam (100 events → 10 processed)', () => {
      const onDrop = jest.fn();
      const strategy = new RateLimitStrategy({ max: 10, window: 1000 }, onDrop, defaultLogger);
      const handler = jest.fn();

      // Send 100 events rapidly
      for (let i = 0; i < 100; i++) {
        strategy.process(createMockMessage({ value: i }), handler);
      }

      expect(handler).toHaveBeenCalledTimes(10); // Only first 10
      expect(strategy.droppedCount).toBe(90); // 90 dropped
      expect(onDrop).toHaveBeenCalledTimes(90);
    });

    test('should handle offline recovery burst', async () => {
      jest.useRealTimers();

      const onDrop = jest.fn();
      const strategy = new RateLimitStrategy({ max: 100, window: 1000 }, onDrop, defaultLogger);
      const handler = jest.fn();

      // Simulate 500 events from offline queue
      for (let i = 0; i < 500; i++) {
        strategy.process(createMockMessage({ value: i }), handler);
      }

      expect(handler).toHaveBeenCalledTimes(100);
      expect(strategy.droppedCount).toBe(400);

      // After 1 second, should allow more
      await sleep(1100);

      const result = strategy.process(createMockMessage({ value: 500 }), handler);
      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledTimes(101);
    });
  });
});
