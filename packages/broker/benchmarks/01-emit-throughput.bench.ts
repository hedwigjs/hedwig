/**
 * 01 · Emit throughput
 *
 * How many multicast `emit` calls per second the broker can process at
 * different subscriber counts. Baseline is 1 subscriber — the pipeline
 * (freeze → hooks → route → afterSend) with the smallest fan-out.
 *
 * What you want to see: throughput scales roughly inversely with
 * subscriber count (dispatch cost dominated by per-subscriber loop).
 */

import type { Client } from '../src/core/client/Client.types';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

/**
 * Factory scope: keeps the sender in a closure that only this task sees.
 * The iteration `fn` never calls `createClient` — that would put the
 * facade's idempotency warning + client-reset on the hot path.
 */
function scenario(subscribers: number) {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      for (let i = 0; i < subscribers; i++) {
        const c = createClient<T, P>(`sub-${i}`);
        c.on('m.evt.v1', () => {
          /* no-op */
        });
      }
    },
    fn: () => {
      void sender!.emit('m.evt.v1', { i: 1 });
    },
    afterAll: () => {
      sender = null;
      destroyBroker();
    },
  };
}

async function run() {
  const bench = newBench();

  for (const subs of [1, 10, 100]) {
    const sc = scenario(subs);
    bench.add(`emit → ${subs} subscribers`, sc.fn, {
      beforeAll: sc.beforeAll,
      afterAll: sc.afterAll,
    });
  }

  await runSuite('01 · Emit throughput — fan-out variations', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
