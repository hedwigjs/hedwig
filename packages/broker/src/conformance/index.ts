/**
 * Transport conformance kit — `@hedwigjs/broker/conformance`.
 *
 * One list of checks that every `Transport` must pass, built-in or custom.
 * Framework-agnostic: each case is `{ name, run }` with its own assertions,
 * so it plugs into jest, vitest, node:test or anything else:
 *
 *   for (const c of transportConformance(() => myPair())) test(c.name, c.run);
 *
 * A *pair* is two transports wired to each other (`a.send` reaches
 * `b.onMessage` and, for duplex wires, the other way round) — the same
 * shape the runtime sees: our end and the peer's end.
 */
import type { Transport } from '../core/transport/Transport.types';
import { buildFrame, parseFrame } from '../core/wire/envelope';

export interface TransportPair {
  /** Our end. */
  a: Transport;
  /** The peer's end. */
  b: Transport;
  /** Optional: make the wire go away from `a`'s point of view (server closes the socket, …). */
  close?: () => void | Promise<void>;
  /** Optional: release anything the pair allocated (ports, servers, timers). */
  dispose?: () => void | Promise<void>;
}

export type TransportPairFactory = () => TransportPair | Promise<TransportPair>;

export interface ConformanceCase {
  name: string;
  run: () => Promise<void>;
}

export interface ConformanceOptions {
  /** How long a delivery may take before the case fails. Default 1000 ms. */
  timeoutMs?: number;
}

class ConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportConformanceError';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConformanceError(message);
}

/** Collect inbound frames on a transport; `next()` awaits the next one. */
function inbox(transport: Transport, timeoutMs: number) {
  const frames: unknown[] = [];
  const waiters: Array<(f: unknown) => void> = [];
  const off = transport.onMessage((frame) => {
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else frames.push(frame);
  });
  return {
    frames,
    off,
    next(): Promise<unknown> {
      if (frames.length > 0) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new ConformanceError(`no frame within ${timeoutMs} ms`)), timeoutMs);
        waiters.push((f) => {
          clearTimeout(timer);
          resolve(f);
        });
      });
    },
    async quiet(ms: number): Promise<number> {
      await new Promise((r) => setTimeout(r, ms));
      return frames.length;
    },
  };
}

/** A frame is either the object we sent or its JSON text — both must parse. */
function normalise(frame: unknown): Record<string, unknown> {
  const parsed = parseFrame(frame);
  assert(parsed.ok, `received frame is not a valid envelope (${!parsed.ok ? parsed.reason : ''})`);
  return parsed.frame as unknown as Record<string, unknown>;
}

function frame(n: number, origin = 'conformance-a') {
  return buildFrame(
    { id: `c-${n}`, topic: 'conformance.ping.v1', source: 'kit', target: '*', data: { n }, timestamp: n },
    origin,
  );
}

async function withPair(factory: TransportPairFactory, body: (pair: TransportPair) => Promise<void>): Promise<void> {
  const pair = await factory();
  try {
    await body(pair);
  } finally {
    try {
      pair.a.destroy();
    } catch {
      /* destroy must be safe; a throwing one is reported by its own case */
    }
    try {
      pair.b.destroy();
    } catch {
      /* same */
    }
    await pair.dispose?.();
  }
}

async function ready(transport: Transport): Promise<void> {
  await (transport.ready ?? Promise.resolve());
}

/**
 * The checks. Order matters only for readability; every case builds its
 * own pair from `factory`.
 */
export function transportConformance(factory: TransportPairFactory, options: ConformanceOptions = {}): ConformanceCase[] {
  const timeoutMs = options.timeoutMs ?? 1000;
  const cases: ConformanceCase[] = [];
  const add = (name: string, run: (pair: TransportPair) => Promise<void>) =>
    cases.push({ name, run: () => withPair(factory, run) });

  add('declares its capability flags consistently', async ({ a, b }) => {
    for (const [label, t] of [
      ['a', a],
      ['b', b],
    ] as const) {
      assert(typeof t.send === 'function', `${label}.send must be a function`);
      assert(typeof t.onMessage === 'function', `${label}.onMessage must be a function`);
      assert(typeof t.destroy === 'function', `${label}.destroy must be a function`);
      assert(t.duplex === undefined || typeof t.duplex === 'boolean', `${label}.duplex must be boolean or absent`);
      assert(t.fanout === undefined || typeof t.fanout === 'boolean', `${label}.fanout must be boolean or absent`);
      assert(
        t.ready === undefined || typeof (t.ready as Promise<void>).then === 'function',
        `${label}.ready must be a promise or absent`,
      );
      assert(t.onClose === undefined || typeof t.onClose === 'function', `${label}.onClose must be a function or absent`);
    }
  });

  add('ready resolves', async ({ a, b }) => {
    const timer = setTimeout(() => {
      throw new ConformanceError('ready did not resolve');
    }, timeoutMs);
    await Promise.race([
      Promise.all([ready(a), ready(b)]),
      new Promise((_, reject) => setTimeout(() => reject(new ConformanceError(`ready did not resolve within ${timeoutMs} ms`)), timeoutMs)),
    ]);
    clearTimeout(timer);
  });

  add('delivers a frame from a to b as a valid envelope', async ({ a, b }) => {
    await ready(a);
    const box = inbox(b, timeoutMs);
    a.send(frame(1));
    const received = normalise(await box.next());
    assert(received.topic === 'conformance.ping.v1', `topic changed in transit: ${String(received.topic)}`);
    assert(received.id === 'c-1', `id changed in transit: ${String(received.id)}`);
    assert(JSON.stringify(received.data) === JSON.stringify({ n: 1 }), 'data changed in transit');
    box.off();
  });

  add('preserves order for a burst of frames', async ({ a, b }) => {
    await ready(a);
    const box = inbox(b, timeoutMs);
    const count = 25;
    for (let i = 0; i < count; i++) a.send(frame(i));
    const ids: unknown[] = [];
    for (let i = 0; i < count; i++) ids.push(normalise(await box.next()).id);
    assert(ids.join(',') === Array.from({ length: count }, (_, i) => `c-${i}`).join(','), `frames arrived out of order: ${ids.join(',')}`);
    box.off();
  });

  add('delivers from b to a when the wire is duplex', async ({ a, b }) => {
    if (a.duplex === false || b.duplex === false) return; // inbound-only: nothing to check
    await ready(b);
    const box = inbox(a, timeoutMs);
    b.send(frame(7, 'conformance-b'));
    const received = normalise(await box.next());
    assert(received.id === 'c-7', 'b → a delivery failed');
    box.off();
  });

  add('send on an inbound-only transport does not throw', async ({ a }) => {
    if (a.duplex !== false) return;
    let threw = false;
    try {
      a.send(frame(1));
    } catch {
      threw = true;
    }
    assert(!threw, 'send() on an inbound-only transport must be a no-op, not an exception');
  });

  add('onMessage returns an unsubscribe that stops delivery', async ({ a, b }) => {
    await ready(a);
    const box = inbox(b, timeoutMs);
    a.send(frame(1));
    await box.next();
    box.off();
    a.send(frame(2));
    const pending = await box.quiet(50);
    assert(pending === 0, 'a frame was delivered after unsubscribe');
  });

  add('destroy stops delivery, is idempotent, and send afterwards does not throw', async ({ a, b }) => {
    await ready(a);
    const box = inbox(b, timeoutMs);
    b.destroy();
    b.destroy();
    a.send(frame(3));
    const pending = await box.quiet(50);
    assert(pending === 0, 'a frame was delivered to a destroyed transport');
    let threw = false;
    try {
      a.destroy();
      a.destroy();
      a.send(frame(4));
    } catch {
      threw = true;
    }
    assert(!threw, 'destroy() must be idempotent and send() after destroy must not throw');
  });

  add('onClose fires when the wire goes away', async (pair) => {
    if (!pair.close || !pair.a.onClose) return; // nothing to observe
    await ready(pair.a);
    const closed = new Promise<void>((resolve) => pair.a.onClose!(() => resolve()));
    await pair.close();
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new ConformanceError(`onClose did not fire within ${timeoutMs} ms`)), timeoutMs)),
    ]);
  });

  return cases;
}

/**
 * Reference implementation: two in-memory ends wired to each other,
 * synchronous delivery. Useful as the baseline the kit is validated
 * against, and as a stand-in for a real wire in unit tests.
 */
export function createMemoryTransportPair(): TransportPair {
  const listeners = { a: null as ((f: unknown) => void) | null, b: null as ((f: unknown) => void) | null };
  const alive = { a: true, b: true };
  const closeCallbacks = { a: [] as Array<() => void>, b: [] as Array<() => void> };
  const make = (self: 'a' | 'b', peer: 'a' | 'b'): Transport => ({
    duplex: true,
    fanout: false,
    send(frame) {
      if (!alive[self] || !alive[peer]) return;
      listeners[peer]?.(JSON.parse(JSON.stringify(frame)));
    },
    onMessage(cb) {
      listeners[self] = cb;
      return () => {
        if (listeners[self] === cb) listeners[self] = null;
      };
    },
    onClose(cb) {
      closeCallbacks[self].push(cb);
      return () => {
        closeCallbacks[self] = closeCallbacks[self].filter((c) => c !== cb);
      };
    },
    destroy() {
      alive[self] = false;
      listeners[self] = null;
    },
  });
  return {
    a: make('a', 'b'),
    b: make('b', 'a'),
    close() {
      alive.b = false;
      for (const cb of closeCallbacks.a.splice(0)) cb();
    },
  };
}
