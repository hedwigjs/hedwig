/**
 * 09 · History append cost
 *
 * An emit on a topic whose contract declares `retention: { last: N }` is
 * recorded into that topic's ring. Cost dominated by the ring write + the
 * deep-freeze of the envelope. Should be O(1) regardless of `N`.
 *
 * We compare an emit on a retained topic against one on a plain topic, at
 * three retention sizes.
 */

import type { Client } from '../src/core/client/Client.types';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

function baseline() {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>({ topics: { 'm.evt.v1': 'event' } });
      sender = createClient<T, P>('sender');
      createClient<T, P>('receiver').on('m.evt.v1', () => {});
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

function scenario(bufferSize: number) {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>({ topics: { 'm.evt.v1': { kind: 'event', retention: { last: bufferSize } } } });
      sender = createClient<T, P>('sender');
      createClient<T, P>('receiver').on('m.evt.v1', () => {});
      for (let i = 0; i < bufferSize; i++) {
        void sender!.emit('m.evt.v1', { i });
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

  const b = baseline();
  bench.add('emit (no retention) — baseline', b.fn, {
    beforeAll: b.beforeAll,
    afterAll: b.afterAll,
  });

  for (const size of [100, 1_000, 10_000]) {
    const sc = scenario(size);
    bench.add(
      `emit on a retained topic (last=${size.toLocaleString()})`,
      sc.fn,
      { beforeAll: sc.beforeAll, afterAll: sc.afterAll },
    );
  }

  await runSuite('09 · History append cost', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
