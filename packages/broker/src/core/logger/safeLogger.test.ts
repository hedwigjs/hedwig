import { createSafeLogger } from './safeLogger';
import type { BrokerLogger } from './BrokerLogger.types';

describe('createSafeLogger', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('forwards warn and error to the wrapped logger with the same arguments', () => {
    const inner: BrokerLogger = { warn: jest.fn(), error: jest.fn() };
    const safe = createSafeLogger(inner);

    safe.warn('broker.bridge.replaced', { bridgeId: 'b' });
    safe.error('handler.failed', { error: 'x' });

    expect(inner.warn).toHaveBeenCalledWith('broker.bridge.replaced', { bridgeId: 'b' });
    expect(inner.error).toHaveBeenCalledWith('handler.failed', { error: 'x' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('a throwing warn() does not propagate and is reported to console.error', () => {
    const boom = new Error('sink down');
    const inner: BrokerLogger = {
      warn: jest.fn(() => {
        throw boom;
      }),
      error: jest.fn(),
    };
    const safe = createSafeLogger(inner);

    expect(() => safe.warn('broker.bridge.replaced', { bridgeId: 'b' })).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      '[broker] logger.failed',
      expect.objectContaining({
        level: 'warn',
        event: 'broker.bridge.replaced',
        meta: { bridgeId: 'b' },
        error: boom,
      }),
    );
  });

  test('a throwing error() does not propagate and is reported to console.error', () => {
    const inner: BrokerLogger = {
      warn: jest.fn(),
      error: jest.fn(() => {
        throw new Error('sink down');
      }),
    };
    const safe = createSafeLogger(inner);

    expect(() => safe.error('handler.failed')).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      '[broker] logger.failed',
      expect.objectContaining({ level: 'error', event: 'handler.failed' }),
    );
  });

  test('never re-enters the wrapped logger while reporting its own failure', () => {
    const inner: BrokerLogger = {
      warn: jest.fn(),
      error: jest.fn(() => {
        throw new Error('sink down');
      }),
    };
    const safe = createSafeLogger(inner);

    safe.error('handler.failed');

    // Exactly one call — the original one. No recursive "log the log failure".
    expect(inner.error).toHaveBeenCalledTimes(1);
  });

  test('survives a console.error that throws too', () => {
    consoleError.mockImplementation(() => {
      throw new Error('console patched');
    });
    const inner: BrokerLogger = {
      warn: jest.fn(),
      error: jest.fn(() => {
        throw new Error('sink down');
      }),
    };
    const safe = createSafeLogger(inner);

    expect(() => safe.error('handler.failed')).not.toThrow();
  });
});
