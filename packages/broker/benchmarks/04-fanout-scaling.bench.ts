/**
 * 04 · Fan-out scaling
 *
 * How emit latency scales with the number of subscribers on a single topic.
 * Ideal shape: linear in subscribers (each one gets one handler call).
 * Superlinear = a bad allocation or copy somewhere in the dispatch loop.
 *
 * The suite also prints ns/subscriber to make the scaling constant visible.
 */

import type { Client } from '../src/core/client/Client.types';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { fmtNs, newBench, runSuite } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

const FANOUTS = [1, 10, 100, 1_000, 10_000] as const;

function scenario(subscribers: number) {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      for (let i = 0; i < subscribers; i++) {
        createClient<T, P>(`sub-${i}`).on('m.evt.v1', () => {});
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
  const bench = newBench({ warmupTime: 300, time: 1500 });

  for (const n of FANOUTS) {
    const sc = scenario(n);
    bench.add(`fanout=${n.toLocaleString()}`, sc.fn, {
      beforeAll: sc.beforeAll,
      afterAll: sc.afterAll,
    });
  }

  await runSuite(
    '04 · Fan-out scaling — 1 topic, N subscribers',
    bench,
    (name) => {
      const n = Number(name.split('=')[1]!.replace(/,/g, ''));
      const task = bench.tasks.find((t) => t.name === name);
      const meanNs =
        task?.result && 'latency' in task.result
          ? (task.result as { latency: { mean: number } }).latency.mean * 1e6
          : NaN;
      return `${fmtNs(meanNs / n)} / subscriber`;
    },
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
