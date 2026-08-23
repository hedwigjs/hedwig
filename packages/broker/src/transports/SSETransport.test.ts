import { SSETransport } from './SSETransport';

/**
 * SSETransport tests.
 *
 * `EventSource` is not available in the default Jest environment (node),
 * so we stub `globalThis.EventSource` with a `FakeEventSource` that
 * captures registered listeners, records constructor args, and exposes a
 * `dispatch()` helper to simulate inbound frames. The transport
 * instantiates EventSource inside its constructor, so the stub must be
 * installed BEFORE `new SSETransport(...)`.
 *
 * Mirrors WebSocketTransport.test.ts in structure — same three sections
 * (send / onMessage / destroy) plus SSE-specific bits (named events,
 * withCredentials, EventSource close on destroy).
 */

type FakeListener = (e: any) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  init: EventSourceInit | undefined;
  close = jest.fn<void, []>();

  #listeners = new Map<string, Set<FakeListener>>();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: FakeListener): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  /** Test helper: simulate an incoming frame on the named event type. */
  dispatch(type: string, data: unknown): void {
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    for (const l of listeners) l({ data });
  }

  /** Test helper: attached listener count on a named event type. */
  listenerCount(type: string): number {
    return this.#listeners.get(type)?.size ?? 0;
  }
}

let originalEventSource: unknown;

beforeAll(() => {
  originalEventSource = (globalThis as any).EventSource;
});

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as any).EventSource = FakeEventSource;
});

afterAll(() => {
  (globalThis as any).EventSource = originalEventSource;
});

describe('SSETransport', () => {
  describe('construction', () => {
    test('opens EventSource against the given URL', () => {
      new SSETransport({ url: 'http://example.test/stream' });

      expect(FakeEventSource.instances).toHaveLength(1);
      expect(FakeEventSource.instances[0]!.url).toBe('http://example.test/stream');
    });

    test('forwards withCredentials to EventSource init', () => {
      new SSETransport({ url: 'http://example.test/stream', withCredentials: true });

      expect(FakeEventSource.instances[0]!.init).toEqual({ withCredentials: true });
    });

    test('defaults withCredentials to false when not provided', () => {
      new SSETransport({ url: 'http://example.test/stream' });

      expect(FakeEventSource.instances[0]!.init).toEqual({ withCredentials: false });
    });
  });

  describe('send (OUTBOUND — no-op)', () => {
    test('never touches EventSource and warns the caller', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const transport = new SSETransport({ url: 'http://example.test/stream' });

      expect(() => transport.send({ action: 'anything' })).not.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/SSETransport.*send\(\) is a no-op/);
      warn.mockRestore();
    });
  });

  describe('onMessage (INBOUND)', () => {
    test('subscribes to the default `message` event type', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      transport.onMessage(jest.fn());

      const es = FakeEventSource.instances[0]!;
      expect(es.listenerCount('message')).toBe(1);
    });

    test('subscribes to a named event when eventName is set', () => {
      const transport = new SSETransport({
        url: 'http://example.test/stream',
        eventName: 'notification',
      });
      transport.onMessage(jest.fn());

      const es = FakeEventSource.instances[0]!;
      expect(es.listenerCount('notification')).toBe(1);
      expect(es.listenerCount('message')).toBe(0);
    });

    test('parses string frames as JSON and delivers the parsed value', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      const cb = jest.fn();
      transport.onMessage(cb);

      FakeEventSource.instances[0]!.dispatch(
        'message',
        JSON.stringify({ kind: 'hello', n: 7 }),
      );

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ kind: 'hello', n: 7 });
    });

    test('forwards non-string frames (already-parsed objects) as-is', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      const cb = jest.fn();
      transport.onMessage(cb);

      const preParsed = { topic: 'x.v1', data: { a: 1 } };
      FakeEventSource.instances[0]!.dispatch('message', preParsed);

      expect(cb).toHaveBeenCalledWith(preParsed);
    });

    test('malformed JSON: logs an error and does NOT call the callback', () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      const cb = jest.fn();
      transport.onMessage(cb);

      FakeEventSource.instances[0]!.dispatch('message', '{not json');

      expect(cb).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalledWith(
        '[SSETransport] Failed to parse message:',
        expect.any(Error),
      );
      err.mockRestore();
    });
  });

  describe('destroy', () => {
    test('removes the EventSource listener', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      transport.onMessage(jest.fn());
      const es = FakeEventSource.instances[0]!;
      expect(es.listenerCount('message')).toBe(1);

      transport.destroy();

      expect(es.listenerCount('message')).toBe(0);
    });

    test('closes the underlying EventSource — the transport owns it', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      transport.onMessage(jest.fn());

      transport.destroy();

      expect(FakeEventSource.instances[0]!.close).toHaveBeenCalledTimes(1);
    });

    test('closes EventSource even when onMessage was never called', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });

      transport.destroy();

      expect(FakeEventSource.instances[0]!.close).toHaveBeenCalledTimes(1);
    });

    test('post-destroy frames do not reach the callback', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      const cb = jest.fn();
      transport.onMessage(cb);

      transport.destroy();
      FakeEventSource.instances[0]!.dispatch('message', JSON.stringify({ late: true }));

      expect(cb).not.toHaveBeenCalled();
    });

    test('the unsubscribe function returned by onMessage also detaches', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      const cb = jest.fn();
      const unsub = transport.onMessage(cb);

      unsub();
      FakeEventSource.instances[0]!.dispatch('message', JSON.stringify({ late: true }));

      expect(cb).not.toHaveBeenCalled();
    });

    test('is idempotent: calling destroy twice does not throw', () => {
      const transport = new SSETransport({ url: 'http://example.test/stream' });
      transport.onMessage(jest.fn());

      transport.destroy();
      expect(() => transport.destroy()).not.toThrow();
    });
  });
});
