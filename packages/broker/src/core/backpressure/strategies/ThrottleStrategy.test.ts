import { ThrottleStrategy } from './ThrottleStrategy';
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

describe('ThrottleStrategy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('should create strategy with valid throttle period', () => {
      expect(() => new ThrottleStrategy(100, defaultLogger)).not.toThrow();
    });

    test('should throw error for invalid throttle period', () => {
      expect(() => new ThrottleStrategy(0, defaultLogger)).toThrow('Throttle period must be positive');
      expect(() => new ThrottleStrategy(-100, defaultLogger)).toThrow('Throttle period must be positive');
    });
  });

  describe('Process', () => {
    test('should execute first event immediately', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();
      const event = createMockMessage({ value: 1 });

      const result = strategy.process(event, handler);

      expect(result).toBe(true); // Executed immediately
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    test('should delay second event within throttle period', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();
      const event1 = createMockMessage({ value: 1 });
      const event2 = createMockMessage({ value: 2 });

      strategy.process(event1, handler);
      const result2 = strategy.process(event2, handler);

      expect(result2).toBe(false); // Delayed
      expect(handler).toHaveBeenCalledTimes(1); // Only first call
    });

    test('should execute pending event after throttle period', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();
      const event1 = createMockMessage({ value: 1 });
      const event2 = createMockMessage({ value: 2 });

      strategy.process(event1, handler);
      strategy.process(event2, handler);

      expect(handler).toHaveBeenCalledTimes(1);

      // Fast-forward time
      jest.advanceTimersByTime(100);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(event2);
    });

    test('should only execute last event when multiple events are pending', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();

      strategy.process(createMockMessage({ value: 1 }), handler);
      strategy.process(createMockMessage({ value: 2 }), handler);
      strategy.process(createMockMessage({ value: 3 }), handler);
      const event4 = createMockMessage({ value: 4 });
      strategy.process(event4, handler);

      expect(handler).toHaveBeenCalledTimes(1); // Only first

      jest.advanceTimersByTime(100);

      expect(handler).toHaveBeenCalledTimes(2); // First + last (event4)
      expect(handler).toHaveBeenLastCalledWith(event4);
    });

    test('should allow execution after throttle period expires', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();
      const event1 = createMockMessage({ value: 1 });
      const event2 = createMockMessage({ value: 2 });

      strategy.process(event1, handler);

      // Wait for throttle period to expire
      jest.advanceTimersByTime(100);

      const result2 = strategy.process(event2, handler);

      expect(result2).toBe(true); // Can execute immediately now
      expect(handler).toHaveBeenCalledTimes(2);
    });

    test('should handle handler errors gracefully', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const handler = jest.fn(() => {
        throw new Error('Handler error');
      });
      const event = createMockMessage({ value: 1 });

      expect(() => strategy.process(event, handler)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Flush', () => {
    test('should execute pending event on flush', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();
      const event1 = createMockMessage({ value: 1 });
      const event2 = createMockMessage({ value: 2 });

      strategy.process(event1, handler);
      strategy.process(event2, handler);

      expect(handler).toHaveBeenCalledTimes(1);

      strategy.flush();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(event2);
    });

    test('should do nothing if no pending events', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();

      strategy.flush();

      expect(handler).not.toHaveBeenCalled();
    });

    test('should clear timeout on flush', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();

      strategy.process(createMockMessage({ value: 1 }), handler);
      strategy.process(createMockMessage({ value: 2 }), handler);

      strategy.flush();

      // Timer should be cleared, no more executions
      jest.advanceTimersByTime(100);
      expect(handler).toHaveBeenCalledTimes(2); // Only from flush, not from timer
    });
  });

  describe('Destroy', () => {
    test('should clear timeout on destroy', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();

      strategy.process(createMockMessage({ value: 1 }), handler);
      strategy.process(createMockMessage({ value: 2 }), handler);

      strategy.destroy();

      // Timer cleared, pending event not executed
      jest.advanceTimersByTime(100);
      expect(handler).toHaveBeenCalledTimes(1); // Only first
    });

    test('should handle destroy with no pending events', () => {
      const strategy = new ThrottleStrategy(100, defaultLogger);

      expect(() => strategy.destroy()).not.toThrow();
    });
  });

  describe('Real-world scenarios', () => {
    test('should throttle high-frequency events (10 events → 2 calls)', () => {
      jest.useRealTimers(); // Use real timers for this test

      const strategy = new ThrottleStrategy(100, defaultLogger);
      const handler = jest.fn();

      // Send 10 events rapidly
      for (let i = 0; i < 10; i++) {
        strategy.process(createMockMessage({ value: i }), handler);
      }

      expect(handler).toHaveBeenCalledTimes(1); // First event

      return sleep(110).then(() => {
        expect(handler).toHaveBeenCalledTimes(2); // First + last
        expect(handler.mock.calls[1][0].data.value).toBe(9); // Last event
      });
    });
  });
});
