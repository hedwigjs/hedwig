/**
 * @jest-environment jsdom
 */

import { PostMessageTransport } from './PostMessageTransport';

/**
 * PostMessageTransport tests.
 *
 * This is the one transport with security-critical behaviour: it must refuse
 * to deliver messages whose origin doesn't match the configured one. These
 * tests guard that refusal — if any of them goes green while broken, the
 * transport becomes a cross-origin injection vector.
 *
 * jsdom is required: we need a real `window`, real `MessageEvent`, real
 * `addEventListener('message')`. Node's test environment does not provide
 * any of this.
 */

/**
 * Build a fake "target window" — an object that pretends to be a Window for
 * the purposes of:
 *   - receiving `transport.send(data)` via its `postMessage` spy;
 *   - appearing as `e.source` on an incoming MessageEvent (we dispatch on
 *     the jsdom `window` ourselves and set `source` to this fake).
 */
function makeFakeTargetWindow() {
  const postMessage = jest.fn();
  const fake = { postMessage } as unknown as Window;
  return { fake, postMessage };
}

/**
 * Dispatch a MessageEvent to the global `window` with the given attributes.
 * We use the MessageEvent constructor (supported in jsdom) to set
 * `source`/`origin`/`data` — these cannot be set after construction.
 */
function fireMessage({
  data,
  source,
  origin,
}: {
  data: unknown;
  source: Window | null;
  origin: string;
}) {
  const event = new MessageEvent('message', { data, origin, source });
  window.dispatchEvent(event);
}

describe('PostMessageTransport', () => {
  describe('send (OUTBOUND)', () => {
    test('forwards data and configured origin to target.postMessage', () => {
      const { fake, postMessage } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({ target: fake, origin: 'https://app.example.com' });

      transport.send({ hello: 'world' });

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({ hello: 'world' }, 'https://app.example.com');
    });

    test("defaults origin to '*' when not provided (permissive send)", () => {
      const { fake, postMessage } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({ target: fake });

      transport.send({ x: 1 });

      expect(postMessage).toHaveBeenCalledWith({ x: 1 }, '*');
    });

    test('logs and swallows errors thrown by target.postMessage', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { fake, postMessage } = makeFakeTargetWindow();
      postMessage.mockImplementation(() => {
        throw new Error('detached frame');
      });
      const transport = new PostMessageTransport({ target: fake });

      expect(() => transport.send({ a: 1 })).not.toThrow();
      expect(spy).toHaveBeenCalledWith(
        '[PostMessageTransport] Failed to send:',
        expect.any(Error),
      );
      spy.mockRestore();
    });
  });

  describe('onMessage (INBOUND) — security', () => {
    test('REJECTS messages whose source window is not the configured target', () => {
      const callback = jest.fn();
      const { fake } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({ target: fake });
      transport.onMessage(callback);

      // Message looks like it came from someone else's window — reject.
      const otherWindow = {} as Window;
      fireMessage({ data: { malicious: true }, source: otherWindow, origin: '*' });

      expect(callback).not.toHaveBeenCalled();

      transport.destroy();
    });

    test('REJECTS messages whose origin does not match when configured origin is explicit', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const callback = jest.fn();
      const { fake } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({
        target: fake,
        origin: 'https://trusted.example.com',
      });
      transport.onMessage(callback);

      fireMessage({
        data: { stolen: 'cookies' },
        source: fake,
        origin: 'https://attacker.example.com',
      });

      expect(callback).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('unauthorized origin'),
      );
      warn.mockRestore();
      transport.destroy();
    });

    test("wildcard origin ('*') accepts messages from any origin (if source matches)", () => {
      const callback = jest.fn();
      const { fake } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({ target: fake, origin: '*' });
      transport.onMessage(callback);

      fireMessage({ data: { ok: true }, source: fake, origin: 'https://whatever.dev' });

      expect(callback).toHaveBeenCalledWith({ ok: true });
      transport.destroy();
    });

    test('happy path: source matches AND origin matches → callback receives data', () => {
      const callback = jest.fn();
      const { fake } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({
        target: fake,
        origin: 'https://trusted.example.com',
      });
      transport.onMessage(callback);

      fireMessage({
        data: { value: 42 },
        source: fake,
        origin: 'https://trusted.example.com',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ value: 42 });
      transport.destroy();
    });
  });

  describe('destroy', () => {
    test('removes the message listener — post-destroy events do not reach the callback', () => {
      const callback = jest.fn();
      const { fake } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({ target: fake, origin: '*' });
      transport.onMessage(callback);

      transport.destroy();

      fireMessage({ data: { late: true }, source: fake, origin: '*' });

      expect(callback).not.toHaveBeenCalled();
    });

    test('the unsubscribe function returned by onMessage also detaches', () => {
      const callback = jest.fn();
      const { fake } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({ target: fake, origin: '*' });

      const unsubscribe = transport.onMessage(callback);
      unsubscribe();

      fireMessage({ data: { late: true }, source: fake, origin: '*' });

      expect(callback).not.toHaveBeenCalled();
    });

    test('is idempotent: second call does not throw', () => {
      const { fake } = makeFakeTargetWindow();
      const transport = new PostMessageTransport({ target: fake });
      transport.onMessage(jest.fn());

      transport.destroy();
      expect(() => transport.destroy()).not.toThrow();
    });
  });
});
