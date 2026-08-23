import { BackpressureHandler } from './BackpressureHandler';
import { defaultLogger } from '../logger/BrokerLogger.types';
import type { Message } from '../types';

// Helper to create mock message
const createMockMessage = (data: any): Message<string, any> => ({
  id: Math.random().toString(36),
  topic: 'test.event.v1',
  source: 'test',
  target: '*',
  data,
  timestamp: Date.now(),
});

describe('BackpressureHandler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Wrap - No Options', () => {
    test('should return original handler when no options provided', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler);

      expect(wrapped).toBe(originalHandler); // Same reference
      expect(handler.activeStrategies).toBe(0); // No strategy created
    });

    test('should return original handler when options is undefined', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, undefined);

      expect(wrapped).toBe(originalHandler);
    });
  });

  describe('Wrap - Throttle', () => {
    test('should create ThrottleStrategy for throttle option', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, {
        backpressure: { throttle: 100 },
      });

      expect(wrapped).not.toBe(originalHandler); // Wrapped
      expect(handler.activeStrategies).toBe(1);
    });

    test('should throttle handler calls', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, {
        backpressure: { throttle: 100 },
      });

      // Call wrapped handler multiple times
      wrapped(createMockMessage({ value: 1 }));
      wrapped(createMockMessage({ value: 2 }));
      wrapped(createMockMessage({ value: 3 }));

      expect(originalHandler).toHaveBeenCalledTimes(1); // Only first call
    });
  });

  describe('Wrap - Debounce', () => {
    test('should create DebounceStrategy for debounce option', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, {
        backpressure: { debounce: 300 },
      });

      expect(wrapped).not.toBe(originalHandler);
      expect(handler.activeStrategies).toBe(1);
    });

    test('should debounce handler calls', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, {
        backpressure: { debounce: 300 },
      });

      wrapped(createMockMessage({ value: 1 }));
      wrapped(createMockMessage({ value: 2 }));

      expect(originalHandler).not.toHaveBeenCalled();

      jest.advanceTimersByTime(300);

      expect(originalHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Wrap - Rate Limit', () => {
    test('should create RateLimitStrategy for rateLimit option', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, {
        backpressure: { rateLimit: { max: 10, window: 1000 } },
      });

      expect(wrapped).not.toBe(originalHandler);
      expect(handler.activeStrategies).toBe(1);
    });

    test('should rate limit events', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();
      const onDrop = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, {
        backpressure: { rateLimit: { max: 3, window: 1000 }, onDrop },
      });

      // Send 5 events
      for (let i = 0; i < 5; i++) {
        wrapped(createMockMessage({ value: i }));
      }

      expect(originalHandler).toHaveBeenCalledTimes(3); // Only first 3
      expect(onDrop).toHaveBeenCalledTimes(2); // 2 dropped
    });
  });

  describe('Multiple Clients', () => {
    test('should handle multiple clients independently', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const wrapped1 = handler.wrap('client-1', 'event.v1', handler1, {
        backpressure: { throttle: 100 },
      });
      const wrapped2 = handler.wrap('client-2', 'event.v1', handler2, {
        backpressure: { debounce: 300 },
      });

      expect(handler.activeStrategies).toBe(2);

      wrapped1(createMockMessage({ value: 1 }));
      wrapped2(createMockMessage({ value: 1 }));

      expect(handler1).toHaveBeenCalledTimes(1); // Throttle: immediate
      expect(handler2).not.toHaveBeenCalled(); // Debounce: delayed
    });

    test('should handle same client with different event types', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const wrapped1 = handler.wrap('client-1', 'event.v1', handler1, {
        backpressure: { throttle: 100 },
      });
      const wrapped2 = handler.wrap('client-1', 'event.v2', handler2, {
        backpressure: { debounce: 300 },
      });

      expect(handler.activeStrategies).toBe(2);
    });
  });

  describe('Remove', () => {
    test('should remove strategy and cleanup', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      handler.wrap('client-1', 'event.v1', originalHandler, { backpressure: { throttle: 100 } });

      expect(handler.activeStrategies).toBe(1);

      handler.remove('client-1', 'event.v1');

      expect(handler.activeStrategies).toBe(0);
    });

    test('should flush pending events on remove', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      const wrapped = handler.wrap('client-1', 'event.v1', originalHandler, {
        backpressure: { debounce: 300 },
      });

      wrapped(createMockMessage({ value: 1 }));

      expect(originalHandler).not.toHaveBeenCalled();

      // Remove (should flush)
      handler.remove('client-1', 'event.v1');

      expect(originalHandler).toHaveBeenCalledTimes(1); // Flushed
    });

    test('should handle remove for non-existent strategy', () => {
      const handler = new BackpressureHandler(defaultLogger);

      expect(() => handler.remove('client-1', 'event.v1')).not.toThrow();
    });
  });

  describe('Destroy', () => {
    test('should cleanup all strategies', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      handler.wrap('client-1', 'event.v1', handler1, { backpressure: { throttle: 100 } });
      handler.wrap('client-2', 'event.v2', handler2, { backpressure: { debounce: 300 } });

      expect(handler.activeStrategies).toBe(2);

      handler.destroy();

      expect(handler.activeStrategies).toBe(0);
    });

    test('should flush all pending events on destroy', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const wrapped1 = handler.wrap('client-1', 'event.v1', handler1, {
        backpressure: { debounce: 300 },
      });
      const wrapped2 = handler.wrap('client-2', 'event.v2', handler2, {
        backpressure: { debounce: 300 },
      });

      wrapped1(createMockMessage({ value: 1 }));
      wrapped2(createMockMessage({ value: 2 }));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();

      handler.destroy();

      expect(handler1).toHaveBeenCalledTimes(1); // Flushed
      expect(handler2).toHaveBeenCalledTimes(1); // Flushed
    });
  });

  describe('Error Cases', () => {
    test('should throw error when no valid option specified', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      expect(() => {
        handler.wrap('client-1', 'event.v1', originalHandler, { backpressure: {} } as any);
      }).toThrow('No backpressure strategy specified');
    });

    test('should throw error when multiple strategies specified', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      expect(() => {
        handler.wrap('client-1', 'event.v1', originalHandler, {
          backpressure: {
            throttle: 100,
            debounce: 300,
          },
        });
      }).toThrow('Multiple backpressure strategies specified: throttle, debounce');
    });

    test('should throw error when all strategies specified', () => {
      const handler = new BackpressureHandler(defaultLogger);
      const originalHandler = jest.fn();

      expect(() => {
        handler.wrap('client-1', 'event.v1', originalHandler, {
          backpressure: {
            throttle: 100,
            debounce: 300,
            rateLimit: { max: 100, window: 1000 },
          },
        });
      }).toThrow('Multiple backpressure strategies specified');
    });
  });
});
