/**
 * 21 · State topic — retained value on subscribe
 *
 * A topic declared `state` keeps its last value, and the runtime hands it
 * to every new subscriber **synchronously**, before `on()` returns, flagged
 * `replayed`. That is what lets a late-mounted module paint the current
 * value without asking the producer to re-send it — so the cost lands on
 * mount, in the component's critical path, not on the message bus.
 *
 * Measured as a subscribe + unsubscribe cycle, against the same cycle on a
 * plain event topic (nothing retained) and on the state topic with
 * `{ retained: false }`, which opts out of the handoff.
 */

import type { Client } from '../src/core/client/Client.types';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'cart.snapshot.v1' | 'm.evt.v1';
type P = {
  'cart.snapshot.v1': { items: Array<{ sku: string; qty: number }>; total: number };
  'm.evt.v1': { i: number };
};

const snapshot = {
  items: [
    { sku: 'ABC-123', qty: 2 },
    { sku: 'XYZ-999', qty: 1 },
  ],
  total: 447,
};

function scenario(topic: T, retained: boolean | undefined) {
  let subscriber: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>({
        topics: { 'cart.snapshot.v1': 'state', 'm.evt.v1': 'event' },
      });
      // A different client, so `noLocal` never hides the retained value.
      void createClient<T, P>('producer').emit('cart.snapshot.v1', snapshot);
      subscriber = createClient<T, P>('subscriber');
    },
    fn: () => {
      const off = subscriber!.on(
        topic,
        () => {},
        retained === undefined ? undefined : { retained },
      );
      off();
    },
    afterAll: () => {
      subscriber = null;
      destroyBroker();
    },
  };
}

async function run() {
  const bench = newBench();

  const cases: Array<[string, T, boolean | undefined]> = [
    ['on() · event topic, nothing retained (baseline)', 'm.evt.v1', undefined],
    ['on() · state topic, retained value delivered', 'cart.snapshot.v1', undefined],
    ['on() · state topic, { retained: false }', 'cart.snapshot.v1', false],
  ];

  for (const [name, topic, retained] of cases) {
    const sc = scenario(topic, retained);
    bench.add(name, sc.fn, { beforeAll: sc.beforeAll, afterAll: sc.afterAll });
  }

  await runSuite('21 · State topic — retained value on subscribe', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
