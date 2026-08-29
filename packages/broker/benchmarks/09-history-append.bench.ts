/**
 * 09 · History append cost
 *
 * `emit(topic, data, { history: true })` records into the message history
 * ring buffer. Cost dominated by the ring-buffer write + deep-freeze of the
 * message envelope. Should be O(1) regardless of buffer size.
 *
 * We compare emit-with-history against a plain emit, at three buffer sizes.
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
      initBroker<T, P>({ history: { enabled: true, maxSize: 100 } });
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
      initBroker<T, P>({ history: { enabled: true, maxSize: bufferSize } });
      sender = createClient<T, P>('sender');
      createClient<T, P>('receiver').on('m.evt.v1', () => {});
      for (let i = 0; i < bufferSize; i++) {
        void sender!.emit('m.evt.v1', { i }, { history: true });
      }
    },
    fn: () => {
      void sender!.emit('m.evt.v1', { i: 1 }, { history: true });
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
  bench.add('emit (no history) — baseline', b.fn, {
    beforeAll: b.beforeAll,
    afterAll: b.afterAll,
  });

  for (const size of [100, 1_000, 10_000]) {
    const sc = scenario(size);
    bench.add(
      `emit + history: true (buffer=${size.toLocaleString()})`,
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
