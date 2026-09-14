/**
 * 18 · Payload handling — freeze in place vs `payloads: 'clone'`
 *
 * `initBroker({ payloads })` decides what happens to the object a module
 * hands to `emit()`. The default `'freeze'` deep-freezes it in place — no
 * copy, but the emitter's own object comes back frozen. `'clone'` runs
 * `structuredClone` first and freezes the copy, so the emitter keeps a
 * mutable original and pays for one copy per message.
 *
 * Method note: every iteration builds a **fresh** payload. Re-emitting one
 * already-frozen object would make `'freeze'` look free — the recursion
 * bails on the first `Object.isFrozen` — and the comparison would be
 * meaningless. The allocation is inside both cases, so it cancels out; read
 * the *difference* between the two, not the absolute numbers.
 */

import type { Client } from '../src/core/client/Client.types';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': Record<string, unknown> };

const flat = (i: number) => ({ i, sku: 'ABC-123', qty: 2, ok: true });

const nested = (i: number) => ({
  id: i,
  user: { id: i, name: 'Ada', roles: ['admin', 'billing'] },
  items: [
    { sku: 'ABC-123', qty: 2, price: { amount: 199, currency: 'EUR' } },
    { sku: 'XYZ-999', qty: 1, price: { amount: 49, currency: 'EUR' } },
  ],
  meta: { ts: i, tags: { source: 'web', ab: 'b' } },
});

function scenario(payloads: 'freeze' | 'clone', make: (i: number) => object) {
  let sender: Client<T, P> | null = null;
  let i = 0;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>({ payloads });
      sender = createClient<T, P>('sender');
      createClient<T, P>('receiver').on('m.evt.v1', () => {});
    },
    fn: () => {
      void sender!.emit('m.evt.v1', make(++i) as P[T]);
    },
    afterAll: () => {
      sender = null;
      destroyBroker();
    },
  };
}

async function run() {
  const bench = newBench();

  const cases: Array<[string, 'freeze' | 'clone', (i: number) => object]> = [
    ['freeze in place · flat payload (default)', 'freeze', flat],
    ["payloads: 'clone' · flat payload", 'clone', flat],
    ['freeze in place · nested payload', 'freeze', nested],
    ["payloads: 'clone' · nested payload", 'clone', nested],
  ];

  for (const [name, payloads, make] of cases) {
    const sc = scenario(payloads, make);
    bench.add(name, sc.fn, {
      beforeAll: sc.beforeAll,
      afterAll: sc.afterAll,
    });
  }

  await runSuite('18 · Payload handling — freeze vs clone', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
