/**
 * 03 · Request round-trip
 *
 * Cost of the request/reply pattern (unicast + handler return captured in
 * RoutingResult.data). Compared against a bare multicast emit to show the
 * overhead of the reply capture path.
 *
 * Sync handler is the ceiling — async handler adds await/microtask cost.
 */

import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'q.sync.v1' | 'q.async.v1' | 'e.oneway.v1';
type P = {
  'q.sync.v1': { i: number };
  'q.async.v1': { i: number };
  'e.oneway.v1': { i: number };
};

async function run() {
  destroyBroker();
  initBroker<T, P>();

  const sender = createClient<T, P>('sender');
  const responder = createClient<T, P>('responder');

  responder.on('q.sync.v1', () => ({ answer: 42 }));
  responder.on('q.async.v1', async () => ({ answer: 42 }));
  responder.on('e.oneway.v1', () => {
    /* no-op */
  });

  const bench = newBench();

  bench.add('request → sync handler', async () => {
    await sender.request('responder', 'q.sync.v1', { i: 1 });
  });

  bench.add('request → async handler', async () => {
    await sender.request('responder', 'q.async.v1', { i: 1 });
  });

  bench.add('emit (baseline, one-way)', () => {
    void sender.emit('e.oneway.v1', { i: 1 });
  });

  await runSuite('03 · Request round-trip vs one-way emit', bench);
  destroyBroker();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
