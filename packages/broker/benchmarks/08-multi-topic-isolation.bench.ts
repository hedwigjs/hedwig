/**
 * 08 · Multi-topic isolation
 *
 * The router indexes subscribers by topic. As the total number of topics
 * grows, dispatch for a single topic should stay O(1) — the topic lookup is
 * a Map access, and only the entries for that specific topic are iterated.
 *
 * We register N unrelated topics with one subscriber each, then emit into
 * a specific one. Throughput should not degrade meaningfully as N grows.
 */

import type { Client } from '../src/core/client/Client.types';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = string;
type P = Record<string, { i: number }>;

function scenario(totalTopics: number) {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      const noise = createClient<T, P>('noise');
      for (let i = 0; i < totalTopics - 1; i++) {
        noise.on(`noise.topic-${i}.v1`, () => {});
      }
      createClient<T, P>('target').on('target.topic.v1', () => {});
    },
    fn: () => {
      void sender!.emit('target.topic.v1', { i: 1 });
    },
    afterAll: () => {
      sender = null;
      destroyBroker();
    },
  };
}

async function run() {
  const bench = newBench();

  for (const total of [10, 100, 1_000, 10_000]) {
    const sc = scenario(total);
    bench.add(`emit into 1 of ${total.toLocaleString()} topics`, sc.fn, {
      beforeAll: sc.beforeAll,
      afterAll: sc.afterAll,
    });
  }

  await runSuite(
    '08 · Multi-topic isolation — dispatch cost vs total topic count',
    bench,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
