import { initBroker, getBroker, createClient, destroyBroker } from './facade';
import { PROTOCOL_VERSION, GLOBAL_REGISTRY_KEY } from './core/protocol';
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

function loadCopyWithProtocol(version: number): Facade {
  let mod!: Facade;
  jest.isolateModules(() => {
    jest.doMock('./core/protocol', () => ({
      PROTOCOL_VERSION: version,
      GLOBAL_REGISTRY_KEY: Symbol.for('@hedwigjs/broker'),
    }));
    mod = require('./facade') as Facade;
  });
  jest.dontMock('./core/protocol');
  return mod;
}

function recordingLogger(): BrokerLogger & { warns: Array<[string, unknown]> } {
  const warns: Array<[string, unknown]> = [];
  return {
    warns,
    warn: (event, meta) => {
      warns.push([event, meta]);
    },
    error: () => {},
  };
}

describe('facade — realm singleton', () => {
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    destroyBroker();
    consoleWarn.mockRestore();
  });

  test('initBroker is idempotent within one copy and does not report a duplicate', () => {
    const logger = recordingLogger();
    const a = initBroker({ logger });
    const b = initBroker();

    expect(b).toBe(a);
    expect(logger.warns.map(([e]) => e)).not.toContain('broker.duplicate_copy');
    expect(a.inspect.getProtocolInfo()).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      duplicateCopies: 0,
      otherProtocolVersions: [],
    });
  });

  test('exposes protocolVersion on the instance', () => {
    expect(initBroker().protocolVersion).toBe(PROTOCOL_VERSION);
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

    const dup = logger.warns.filter(([e]) => e === 'broker.duplicate_copy');
    expect(dup).toHaveLength(1);
    expect(dup[0]![1]).toEqual(
      expect.objectContaining({ protocolVersion: PROTOCOL_VERSION, copies: 1 }),
    );
    expect(events).toHaveLength(1);
    expect(first.inspect.getProtocolInfo().duplicateCopies).toBe(1);
  });

  test('each additional copy increments the count', () => {
    const first = initBroker();
    loadSecondCopy().getBroker();
    loadSecondCopy().getBroker();

    expect(first.inspect.getProtocolInfo().duplicateCopies).toBe(2);
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

  test('a copy speaking another protocol version gets its own broker and a protocol_mismatch warning', () => {
    const first = initBroker();
    const events: unknown[] = [];
    first.$systemEvents.on('broker.protocol_mismatch', (p) => events.push(p));

    const logger = recordingLogger();
    const other = loadCopyWithProtocol(99);
    const foreign = other.initBroker({ logger });

    expect(foreign).not.toBe(first);
    expect(foreign.protocolVersion).toBe(99);
    expect(logger.warns.find(([e]) => e === 'broker.protocol_mismatch')?.[1]).toEqual(
      expect.objectContaining({ protocolVersion: 99, otherVersions: [PROTOCOL_VERSION] }),
    );
    expect(foreign.inspect.getProtocolInfo().otherProtocolVersions).toEqual([PROTOCOL_VERSION]);
    // The first broker was created before the second existed, so it saw no mismatch.
    expect(events).toHaveLength(0);
    expect(getBroker()).toBe(first);

    other.destroyBroker();
  });
});
