import { initBroker, getBroker, createClient, destroyBroker } from './facade';
import { VERSION, GLOBAL_REGISTRY_KEY, isCompatibleVersion } from './core/version';
import type { BrokerLogger } from './core/logger/BrokerLogger.types';

/**
 * Realm-singleton tests.
 *
 * `jest.isolateModules` gives a fresh module registry: `require('./facade')`
 * inside it returns a SECOND copy of the facade and of every module it
 * imports, exactly like a page that bundles `@hedwigjs/broker` twice. Both
 * copies share this test file's `globalThis`, which is what the registry
 * slot relies on.
 */

type Facade = typeof import('./facade');

function loadSecondCopy(): Facade {
  let mod!: Facade;
  jest.isolateModules(() => {
    mod = require('./facade') as Facade;
  });
  return mod;
}

/** A copy of the library that reports a different package version. */
function loadCopyWithVersion(version: string): Facade {
  let mod!: Facade;
  jest.isolateModules(() => {
    jest.doMock('./core/version', () => {
      const real = jest.requireActual('./core/version') as typeof import('./core/version');
      return { ...real, VERSION: version };
    });
    mod = require('./facade') as Facade;
  });
  jest.dontMock('./core/version');
  return mod;
}

function recordingLogger(): BrokerLogger & { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    warn: (event, meta) => {
      calls.push(['warn', event, meta]);
    },
    error: (event, meta) => {
      calls.push(['error', event, meta]);
    },
  };
}

describe('isCompatibleVersion', () => {
  test.each([
    ['0.2.3', '0.2.9', true],
    ['0.2.3', '0.3.0', false],
    ['0.2.3', '1.0.0', false],
    ['1.4.0', '1.9.2', true],
    ['1.4.0', '2.0.0', false],
    ['0.0.0-dev', '0.0.0-dev', true],
    ['weird', 'weird', true],
    ['weird', '0.2.0', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(isCompatibleVersion(a, b)).toBe(expected);
  });
});

describe('facade — realm singleton', () => {
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    destroyBroker();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  test('initBroker is idempotent within one copy and does not report a duplicate', () => {
    const logger = recordingLogger();
    const a = initBroker({ logger });
    const b = initBroker();

    expect(b).toBe(a);
    expect(logger.calls.map(([, e]) => e)).not.toContain('broker.duplicate_copy');
    expect(a.inspect.getVersionInfo()).toEqual({ version: VERSION, duplicateCopies: 0 });
  });

  test('exposes the package version on the instance', () => {
    expect(initBroker().version).toBe(VERSION);
  });

  test('a second copy of the library reuses the instance created by the first', () => {
    const first = initBroker();
    const copy = loadSecondCopy();

    expect(copy.getBroker()).toBe(first);
    expect(copy.initBroker()).toBe(first);
  });

  test('the second copy is reported once: logger warn + broker.duplicate_copy event', () => {
    const logger = recordingLogger();
    const first = initBroker({ logger });
    const events: unknown[] = [];
    first.$systemEvents.on('broker.duplicate_copy', (p) => events.push(p));

    const copy = loadSecondCopy();
    copy.getBroker();
    copy.getBroker();
    copy.initBroker();

    const dup = logger.calls.filter(([, e]) => e === 'broker.duplicate_copy');
    expect(dup).toHaveLength(1);
    expect(dup[0]![2]).toEqual(
      expect.objectContaining({ version: VERSION, copyVersion: VERSION, copies: 1 }),
    );
    expect(events).toHaveLength(1);
    expect(first.inspect.getVersionInfo().duplicateCopies).toBe(1);
  });

  test('each additional copy increments the count', () => {
    const first = initBroker();
    loadSecondCopy().getBroker();
    loadSecondCopy().getBroker();

    expect(first.inspect.getVersionInfo().duplicateCopies).toBe(2);
  });

  test('a client created from the second copy registers on the shared broker and receives messages', async () => {
    const first = initBroker();
    const copy = loadSecondCopy();

    const seen: unknown[] = [];
    const foreign = copy.createClient('foreign');
    foreign.on('ping.v1', (m) => seen.push(m.data));

    const local = createClient('local');
    const result = await local.emit('ping.v1', { n: 1 });

    expect(first.inspect.getClients().map((c) => c.id)).toEqual(
      expect.arrayContaining(['foreign', 'local']),
    );
    expect(result.recipientIds).toEqual(['foreign']);
    expect(seen).toEqual([{ n: 1 }]);
  });

  test('destroyBroker from the first copy frees the slot for every copy', () => {
    const first = initBroker();
    const copy = loadSecondCopy();
    expect(copy.getBroker()).toBe(first);

    destroyBroker();

    expect(() => copy.getBroker()).toThrow(/not initialized/);
    const fresh = copy.initBroker();
    expect(fresh).not.toBe(first);
    // The first copy now adopts the instance the second copy created.
    expect(getBroker()).toBe(fresh);
    copy.destroyBroker();
  });

  test('registry lives on globalThis as a non-enumerable symbol property', () => {
    initBroker();

    expect(Object.keys(globalThis)).not.toContain(String(GLOBAL_REGISTRY_KEY));
    expect(Object.getOwnPropertySymbols(globalThis)).toContain(Symbol.for('@hedwigjs/broker'));
    const desc = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_REGISTRY_KEY);
    expect(desc).toEqual(
      expect.objectContaining({ enumerable: false, writable: false, configurable: false }),
    );
  });

  describe('incompatible copy', () => {
    test('initBroker / getBroker / createClient throw and never create a second broker', () => {
      const logger = recordingLogger();
      const first = initBroker({ logger });
      const clientsBefore = first.inspect.getClients().length;

      const other = loadCopyWithVersion('0.9.0'); // VERSION is 0.1.x in jest (baked from package.json) → different minor

      expect(() => other.initBroker()).toThrow(/already exists in this realm/);
      expect(() => other.getBroker()).toThrow(/already exists in this realm/);
      expect(() => other.createClient('x')).toThrow(/already exists in this realm/);

      // Nothing was created or registered; the existing broker is untouched.
      expect(getBroker()).toBe(first);
      expect(first.inspect.getClients().length).toBe(clientsBefore);
      expect(first.inspect.getVersionInfo().duplicateCopies).toBe(0);
      expect(logger.calls).toContainEqual([
        'error',
        'broker.version_incompatible',
        expect.objectContaining({ existing: VERSION, thisCopy: '0.9.0' }),
      ]);
    });

    test('a compatible copy (same minor, different patch) adopts normally', () => {
      const first = initBroker();
      // Same major.minor as this copy, one patch up — whatever the baked version is.
      const [major, minor, patch] = VERSION.split('-')[0]!.split('.').map(Number);
      const other = loadCopyWithVersion(`${major}.${minor}.${(patch ?? 0) + 1}`);

      expect(other.getBroker()).toBe(first);
      expect(first.inspect.getVersionInfo().duplicateCopies).toBe(1);
    });
  });
});
