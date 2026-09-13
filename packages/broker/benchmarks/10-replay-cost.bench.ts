/**
 * 10 · Replay cost on subscribe
 *
 * `client.on(topic, h, { replay: { limit: N } })` reads the topic's retained
 * messages (`retention: { last: N }` in its contract) and hands them to the
 * new handler synchronously. Cost scales with the query + delivery loop.
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
    bench.add(`replay ${n} retained messages`, () => {
      // Synchronous: every retained entry reaches the handler before on() returns.
      const c = createClient<T, P>('replayer');
      let seen = 0;
      c.on(
        'm.evt.v1',
        () => {
          seen++;
        },
        { replay: { limit: n } },
      );
      if (seen !== n) throw new Error(`replayed ${seen} of ${n}`);
      c.destroy();
    }, {
      beforeAll: () => {
        destroyBroker();
        initBroker<T, P>({
          topics: { 'm.evt.v1': { kind: 'event', retention: { last: n } } },
          logger: SILENT_LOGGER,
        });
        const s = createClient<T, P>('sender');
        for (let i = 0; i < n; i++) {
          void s.emit('m.evt.v1', { i });
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
