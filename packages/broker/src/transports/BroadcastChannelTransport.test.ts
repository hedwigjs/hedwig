import { BroadcastChannelTransport } from './BroadcastChannelTransport';

/**
 * BroadcastChannelTransport tests.
 *
 * Node's native `BroadcastChannel` is worker-thread-scoped: two channels
 * created in the same main thread do NOT exchange messages. For an
 * in-process inter-channel test we therefore install an in-memory stub as
 * `globalThis.BroadcastChannel` for the duration of the suite.
 *
 * The stub behaves like the browser `BroadcastChannel`:
 *   - messages are delivered synchronously (via queueMicrotask) to every
 *     OTHER live channel of the same name,
 *   - the SENDER does not receive its own message,
 *   - `close()` detaches the channel from the registry and makes any
 *     subsequent `postMessage` throw a `DOMException`-like error.
 *
 * This is the same level of abstraction we used for WebSocketTransport
 * (FakeSocket) — we keep the transport under test, not the runtime.
 */

/* -----------------------------------------------------------------------
 * In-memory BroadcastChannel stub (installed globally in beforeAll)
 * ----------------------------------------------------------------------- */

type Listener = (e: { data: unknown }) => void;

class InMemoryBroadcastChannel {
  static #registry: Map<string, Set<InMemoryBroadcastChannel>> = new Map();

  readonly name: string;
  onmessage: Listener | null = null;
  #closed = false;

  constructor(name: string) {
    this.name = name;
    if (!InMemoryBroadcastChannel.#registry.has(name)) {
      InMemoryBroadcastChannel.#registry.set(name, new Set());
    }
    InMemoryBroadcastChannel.#registry.get(name)!.add(this);
  }

  postMessage(data: unknown): void {
    if (this.#closed) {
      const err = new Error('InvalidStateError: channel is closed');
      (err as any).name = 'InvalidStateError';
      throw err;
    }
    const peers = InMemoryBroadcastChannel.#registry.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue; // sender does not receive its own
      queueMicrotask(() => peer.onmessage?.({ data }));
    }
  }

  close(): void {
    this.#closed = true;
    InMemoryBroadcastChannel.#registry.get(this.name)?.delete(this);
    this.onmessage = null;
  }
}

let originalBC: any;

beforeAll(() => {
  originalBC = (globalThis as any).BroadcastChannel;
  (globalThis as any).BroadcastChannel = InMemoryBroadcastChannel;
});

afterAll(() => {
  (globalThis as any).BroadcastChannel = originalBC;
});

/* -----------------------------------------------------------------------
 * Test helpers
 * ----------------------------------------------------------------------- */

let channelCounter = 0;
const uniqueName = () => `broker-test-${++channelCounter}`;

/** Flush queued microtasks — our stub delivers via `queueMicrotask`. */
const flushBus = () => Promise.resolve();

/** Cleanup list so an unclosed transport in a failing test doesn't leak. */
const toCleanup: BroadcastChannelTransport[] = [];
function track<T extends BroadcastChannelTransport>(t: T): T {
  toCleanup.push(t);
  return t;
}
afterEach(() => {
  while (toCleanup.length) {
    try {
      toCleanup.pop()?.destroy();
    } catch {
      /* already destroyed */
    }
  }
});

/* -----------------------------------------------------------------------
 * Tests
 * ----------------------------------------------------------------------- */

describe('BroadcastChannelTransport', () => {
  describe('send ⇄ onMessage (INTER-TRANSPORT)', () => {
    test('sender → other receiver: receiver gets the exact payload', async () => {
      const name = uniqueName();
      const sender = track(new BroadcastChannelTransport(name));
      const receiver = track(new BroadcastChannelTransport(name));

      const received: unknown[] = [];
      receiver.onMessage((data) => received.push(data));

      sender.send({ kind: 'hello', n: 1 });
      await flushBus();

      expect(received).toEqual([{ kind: 'hello', n: 1 }]);
    });

    test('sender does NOT receive its own broadcast (matches spec)', async () => {
      const name = uniqueName();
      const a = track(new BroadcastChannelTransport(name));

      const echoed: unknown[] = [];
      a.onMessage((data) => echoed.push(data));

      a.send({ self: true });
      await flushBus();

      expect(echoed).toEqual([]);
    });

    test('one sender → multiple receivers: every other receiver gets the payload', async () => {
      const name = uniqueName();
      const sender = track(new BroadcastChannelTransport(name));
      const r1 = track(new BroadcastChannelTransport(name));
      const r2 = track(new BroadcastChannelTransport(name));

      const c1 = jest.fn();
      const c2 = jest.fn();
      r1.onMessage(c1);
      r2.onMessage(c2);

      sender.send({ broadcast: 'ping' });
      await flushBus();

      expect(c1).toHaveBeenCalledWith({ broadcast: 'ping' });
      expect(c2).toHaveBeenCalledWith({ broadcast: 'ping' });
    });

    test('channels are isolated by name: different names do not cross', async () => {
      const a = track(new BroadcastChannelTransport(uniqueName()));
      const b = track(new BroadcastChannelTransport(uniqueName()));

      const cbB = jest.fn();
      b.onMessage(cbB);
      a.send({ from: 'a' });

      await flushBus();
      expect(cbB).not.toHaveBeenCalled();
    });
  });

  describe('send — error handling', () => {
    test('errors thrown by channel.postMessage are swallowed and logged', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const transport = track(new BroadcastChannelTransport(uniqueName()));

      // Close the channel → subsequent postMessage throws in our stub.
      transport.destroy();

      expect(() => transport.send({ oops: true })).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        '[BroadcastChannelTransport] Failed to send:',
        expect.anything(),
      );
      spy.mockRestore();
    });
  });

  describe('destroy', () => {
    test('after destroy, subsequent inbound messages are not delivered', async () => {
      const name = uniqueName();
      const receiver = new BroadcastChannelTransport(name);
      const sender = track(new BroadcastChannelTransport(name));

      const cb = jest.fn();
      receiver.onMessage(cb);
      receiver.destroy();

      sender.send({ too: 'late' });
      await flushBus();

      expect(cb).not.toHaveBeenCalled();
    });

    test('the unsubscribe function returned by onMessage detaches the callback', async () => {
      const name = uniqueName();
      const receiver = track(new BroadcastChannelTransport(name));
      const sender = track(new BroadcastChannelTransport(name));

      const cb = jest.fn();
      const unsub = receiver.onMessage(cb);
      unsub(); // equivalent to destroy() per current implementation

      sender.send({ ignore: true });
      await flushBus();

      expect(cb).not.toHaveBeenCalled();
    });
  });
});
