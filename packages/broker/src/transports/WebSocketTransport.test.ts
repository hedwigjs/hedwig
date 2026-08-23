import { WebSocketTransport } from './WebSocketTransport';

/**
 * WebSocketTransport tests.
 *
 * We deliberately do NOT bring `mock-socket` or jsdom into this suite. The
 * transport is a thin wrapper over `WebSocket`, so a minimal `FakeSocket`
 * that implements just `readyState`, `send`, `addEventListener`,
 * `removeEventListener`, plus a `dispatch()` helper to simulate inbound
 * frames, is enough to exercise every branch.
 *
 * One subtlety: the transport compares `socket.readyState` against
 * `WebSocket.OPEN` — that references the GLOBAL `WebSocket` constructor.
 * On Node 22 (our current env) `globalThis.WebSocket` is native. We guard
 * against older environments by injecting a stand-in if absent.
 */

// Ensure `WebSocket.OPEN` resolves somewhere, even if globalThis.WebSocket
// happens to be missing in the current Jest env.
beforeAll(() => {
  const g = globalThis as any;
  if (typeof g.WebSocket === 'undefined') {
    g.WebSocket = { OPEN: 1 };
  }
});

/** WebSocket.OPEN === 1 in every browser/Node runtime that defines it. */
const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

/**
 * Minimal stand-in for a WebSocket. Captures registered 'message' listeners
 * and provides a `dispatch()` helper to simulate incoming frames. Shape
 * matches the properties the transport touches; typed as `WebSocket` via
 * `unknown` cast because we intentionally don't implement the full interface.
 */
class FakeSocket {
  readyState: number = OPEN;
  send = jest.fn<void, [string]>();

  #listeners = new Map<string, Set<(e: any) => void>>();

  addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  /** Test helper: simulate an inbound 'message' frame. */
  dispatch(data: unknown): void {
    const listeners = this.#listeners.get('message');
    if (!listeners) return;
    for (const l of listeners) l({ data });
  }

  /** Test helper: how many 'message' listeners are still attached. */
  listenerCount(type: string): number {
    return this.#listeners.get(type)?.size ?? 0;
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

describe('WebSocketTransport', () => {
  describe('send (OUTBOUND)', () => {
    test('JSON-serializes data and forwards it to socket.send when OPEN', () => {
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());

      transport.send({ action: 'ping', n: 1 });

      expect(sock.send).toHaveBeenCalledTimes(1);
      expect(sock.send).toHaveBeenCalledWith(JSON.stringify({ action: 'ping', n: 1 }));
    });

    test('does NOT send when socket is CONNECTING — warns instead', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const sock = new FakeSocket();
      sock.readyState = CONNECTING;
      const transport = new WebSocketTransport(sock.asWebSocket());

      transport.send({ a: 1 });

      expect(sock.send).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[WebSocketTransport] Cannot send: socket not open',
      );
      warn.mockRestore();
    });

    test('does NOT send when socket is CLOSED — warns instead', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const sock = new FakeSocket();
      sock.readyState = CLOSED;
      const transport = new WebSocketTransport(sock.asWebSocket());

      transport.send({ a: 1 });

      expect(sock.send).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    test('swallows and logs errors thrown by socket.send', () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const sock = new FakeSocket();
      sock.send.mockImplementation(() => {
        throw new Error('network down');
      });
      const transport = new WebSocketTransport(sock.asWebSocket());

      expect(() => transport.send({ x: 1 })).not.toThrow();
      expect(err).toHaveBeenCalledWith(
        '[WebSocketTransport] Failed to send:',
        expect.any(Error),
      );
      err.mockRestore();
    });

    test('propagates JSON-serialization errors via the catch (circular refs)', () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());

      const circular: any = {};
      circular.self = circular;

      expect(() => transport.send(circular)).not.toThrow();
      expect(sock.send).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalledWith(
        '[WebSocketTransport] Failed to send:',
        expect.any(Error),
      );
      err.mockRestore();
    });
  });

  describe('onMessage (INBOUND)', () => {
    test('parses string frames as JSON and delivers the parsed value', () => {
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());
      const cb = jest.fn();
      transport.onMessage(cb);

      sock.dispatch(JSON.stringify({ kind: 'hello', n: 7 }));

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ kind: 'hello', n: 7 });
    });

    test('forwards non-string frames (object, Blob-like) as-is without parsing', () => {
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());
      const cb = jest.fn();
      transport.onMessage(cb);

      const binary = { type: 'Buffer', byteLength: 4 } as any;
      sock.dispatch(binary);

      expect(cb).toHaveBeenCalledWith(binary);
    });

    test('malformed JSON: logs an error and does NOT call the callback', () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());
      const cb = jest.fn();
      transport.onMessage(cb);

      sock.dispatch('{not json');

      expect(cb).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalledWith(
        '[WebSocketTransport] Failed to parse message:',
        expect.any(Error),
      );
      err.mockRestore();
    });
  });

  describe('destroy', () => {
    test('removes the socket message listener', () => {
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());
      transport.onMessage(jest.fn());
      expect(sock.listenerCount('message')).toBe(1);

      transport.destroy();

      expect(sock.listenerCount('message')).toBe(0);
    });

    test('does NOT close the underlying socket (socket is managed externally)', () => {
      const sock = new FakeSocket();
      (sock as any).close = jest.fn();
      const transport = new WebSocketTransport(sock.asWebSocket());
      transport.onMessage(jest.fn());

      transport.destroy();

      expect((sock as any).close).not.toHaveBeenCalled();
    });

    test('post-destroy messages do not reach the callback', () => {
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());
      const cb = jest.fn();
      transport.onMessage(cb);

      transport.destroy();
      sock.dispatch(JSON.stringify({ late: true }));

      expect(cb).not.toHaveBeenCalled();
    });

    test('the unsubscribe function returned by onMessage also detaches', () => {
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());
      const cb = jest.fn();
      const unsub = transport.onMessage(cb);

      unsub();
      sock.dispatch(JSON.stringify({ late: true }));

      expect(cb).not.toHaveBeenCalled();
    });

    test('is idempotent: calling destroy twice does not throw', () => {
      const sock = new FakeSocket();
      const transport = new WebSocketTransport(sock.asWebSocket());
      transport.onMessage(jest.fn());

      transport.destroy();
      expect(() => transport.destroy()).not.toThrow();
    });
  });
});
