import { DebounceStrategy } from './DebounceStrategy';
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

describe('DebounceStrategy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('should create strategy with valid debounce period', () => {
      expect(() => new DebounceStrategy(300, defaultLogger)).not.toThrow();
    });

    test('should throw error for invalid debounce period', () => {
      expect(() => new DebounceStrategy(0, defaultLogger)).toThrow('Debounce period must be positive');
      expect(() => new DebounceStrategy(-100, defaultLogger)).toThrow('Debounce period must be positive');
    });
  });

  describe('Process', () => {
    test('should not execute immediately', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();
      const event = createMockMessage({ value: 1 });

      const result = strategy.process(event, handler);

      expect(result).toBe(false); // Always delayed
      expect(handler).not.toHaveBeenCalled();
    });

    test('should execute after debounce period', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();
      const event = createMockMessage({ value: 1 });

      strategy.process(event, handler);
      expect(handler).not.toHaveBeenCalled();

      // Fast-forward time
      jest.advanceTimersByTime(300);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    test('should reset timer on new event', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();
      const event1 = createMockMessage({ value: 1 });
      const event2 = createMockMessage({ value: 2 });

      strategy.process(event1, handler);
      jest.advanceTimersByTime(200); // Wait 200ms (not enough)

      strategy.process(event2, handler); // Reset timer

      // Wait original 300ms from first event (total 500ms)
      jest.advanceTimersByTime(100); // Total 300ms from first

      expect(handler).not.toHaveBeenCalled(); // Timer was reset

      // Wait full debounce period from second event
      jest.advanceTimersByTime(200); // Total 300ms from second

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event2); // Last event
    });

    test('should only execute last event', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();
      const event1 = createMockMessage({ value: 1 });
      const event2 = createMockMessage({ value: 2 });
      const event3 = createMockMessage({ value: 3 });

      strategy.process(event1, handler);
      strategy.process(event2, handler);
      strategy.process(event3, handler);

      jest.advanceTimersByTime(300);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event3); // Last event only
    });

    test('should handle handler errors gracefully', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const handler = jest.fn(() => {
        throw new Error('Handler error');
      });
      const event = createMockMessage({ value: 1 });

      strategy.process(event, handler);
      jest.advanceTimersByTime(300);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Flush', () => {
    test('should execute pending event on flush', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();
      const event = createMockMessage({ value: 1 });

      strategy.process(event, handler);
      expect(handler).not.toHaveBeenCalled();

      strategy.flush();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    test('should do nothing if no pending events', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();

      strategy.flush();

      expect(handler).not.toHaveBeenCalled();
    });

    test('should clear timeout on flush', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();
      const event = createMockMessage({ value: 1 });

      strategy.process(event, handler);
      strategy.flush();

      // Timer should be cleared, no more executions
      jest.advanceTimersByTime(300);
      expect(handler).toHaveBeenCalledTimes(1); // Only from flush
    });
  });

  describe('Destroy', () => {
    test('should clear timeout on destroy', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();
      const event = createMockMessage({ value: 1 });

      strategy.process(event, handler);
      strategy.destroy();

      // Timer cleared, event not executed
      jest.advanceTimersByTime(300);
      expect(handler).not.toHaveBeenCalled();
    });

    test('should handle destroy with no pending events', () => {
      const strategy = new DebounceStrategy(300, defaultLogger);

      expect(() => strategy.destroy()).not.toThrow();
    });
  });

  describe('Real-world scenarios', () => {
    test('should debounce search input (simulate typing)', () => {
      jest.useRealTimers();

      const strategy = new DebounceStrategy(300, defaultLogger);
      const handler = jest.fn();

      // Simulate typing "React" (5 keystrokes)
      strategy.process(createMockMessage({ query: 'R' }), handler);
      return sleep(50)
        .then(() => strategy.process(createMockMessage({ query: 'Re' }), handler))
        .then(() => sleep(50))
        .then(() => strategy.process(createMockMessage({ query: 'Rea' }), handler))
        .then(() => sleep(50))
        .then(() => strategy.process(createMockMessage({ query: 'Reac' }), handler))
        .then(() => sleep(50))
        .then(() => strategy.process(createMockMessage({ query: 'React' }), handler))
        .then(() => {
          expect(handler).not.toHaveBeenCalled(); // Still typing
          return sleep(310); // Wait for debounce
        })
        .then(() => {
          expect(handler).toHaveBeenCalledTimes(1); // Only after pause
          expect(handler.mock.calls[0][0].data.query).toBe('React'); // Last query
        });
    });

    test('should handle rapid successive events (10 events → 1 call)', () => {
      jest.useRealTimers();

      const strategy = new DebounceStrategy(100, defaultLogger);
      const handler = jest.fn();

      // Send 10 events rapidly
      for (let i = 0; i < 10; i++) {
        strategy.process(createMockMessage({ value: i }), handler);
      }

      expect(handler).not.toHaveBeenCalled();

      return sleep(110).then(() => {
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].data.value).toBe(9); // Last event
      });
    });
  });
});
