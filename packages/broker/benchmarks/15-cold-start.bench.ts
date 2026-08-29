/**
 * 15 · Cold start — initBroker + createClient churn
 *
 * Broker + N clients bootstrap cost. Relevant for app-shell startup budget:
 * how much of the "time to interactive" pie does the messaging layer take.
 */

import { createClient, destroyBroker, initBroker } from '../src/facade';
import { fmtNs, percentile } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

const RUNS = 200;

async function measureCycle(clients: number): Promise<number[]> {
  const samples: number[] = [];
  // Warm
  for (let i = 0; i < 10; i++) {
    destroyBroker();
    initBroker<T, P>();
    for (let c = 0; c < clients; c++) createClient<T, P>(`c-${c}`);
  }
  for (let i = 0; i < RUNS; i++) {
    destroyBroker();
    const start = performance.now();
    initBroker<T, P>();
    for (let c = 0; c < clients; c++) createClient<T, P>(`c-${c}`);
    samples.push((performance.now() - start) * 1e6);
  }
  destroyBroker();
  samples.sort((a, b) => a - b);
  return samples;
}

async function run() {
  console.log('\n══ 15 · Cold start (initBroker + N × createClient) ══\n');

  for (const clients of [1, 10, 100]) {
    const samples = await measureCycle(clients);
    console.log(
      `  clients=${clients.toString().padStart(3)}  ·  p50 ${fmtNs(percentile(samples, 50)).padStart(9)}  ·  p95 ${fmtNs(percentile(samples, 95)).padStart(9)}  ·  p99 ${fmtNs(percentile(samples, 99)).padStart(9)}  ·  max ${fmtNs(samples[samples.length - 1]!)}`,
    );
  }
  console.log('');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
