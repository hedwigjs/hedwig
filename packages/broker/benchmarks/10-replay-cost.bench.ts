/**
 * 10 · Replay cost on subscribe
 *
 * `client.on(topic, h, { replay: { limit: N } })` filters the history buffer
 * for matching messages and dispatches them to the new handler on the
 * microtask queue. Cost scales with the query + delivery loop.
 *
 * We measure the "subscribe + wait for replay done" cycle at different
 * buffer / replay-limit sizes.
 */

import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite, SILENT_LOGGER } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

async function run() {
  const bench = newBench({ time: 1200 });

  for (const n of [10, 100, 1_000]) {
    bench.add(`replay ${n} historical messages`, async () => {
      const c = createClient<T, P>('replayer');
      let seen = 0;
      const off = c.on(
        'm.evt.v1',
        () => {
          seen++;
        },
        { replay: { limit: n } },
      );
      // Replay is queueMicrotask'd — wait a microtask tick
      await Promise.resolve();
      // Guarantee full replay in a light spin (up to 20 microtasks)
      let spins = 0;
      while (seen < n && spins++ < 20) await Promise.resolve();
      off();
    }, {
      beforeAll: () => {
        destroyBroker();
        // Silent logger: iteration re-creates the same `replayer` client id
        // to force replay each time — that raises an expected
        // `facade.createClient.reset` warn on every iteration.
        initBroker<T, P>({
          history: { enabled: true, maxSize: n },
          logger: SILENT_LOGGER,
        });
        const s = createClient<T, P>('sender');
        for (let i = 0; i < n; i++) {
          void s.emit('m.evt.v1', { i }, { history: true });
        }
      },
      afterAll: () => destroyBroker(),
    });
  }

  await runSuite('10 · Replay cost on subscribe', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
