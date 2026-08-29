/**
 * 14 · Contention & jitter — burst of concurrent publishers
 *
 * The broker is single-threaded (JS), but bursty producers can cause tail
 * latency spikes if any per-emit allocation forces GC. Measure round-trip
 * time for the LAST message in a burst — that's the metric that matters
 * for interactive UIs during a mass event (page load, big list render).
 *
 * We fire 1000 emits in a synchronous burst and record how long the whole
 * burst takes; p50/p99 over many bursts reveals jitter.
 */

import { createClient, destroyBroker, initBroker } from '../src/facade';
import { fmtNs, percentile } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

const BURST = 1_000;
const RUNS = 500;

async function run() {
  console.log('\n══ 14 · Contention & jitter (bursts of 1,000 emits × 500 runs) ══\n');

  destroyBroker();
  initBroker<T, P>();
  const senders: Array<ReturnType<typeof createClient<T, P>>> = [];
  for (let i = 0; i < 10; i++) senders.push(createClient<T, P>(`s-${i}`));
  const receiver = createClient<T, P>('r');
  receiver.on('m.evt.v1', () => {});

  // Warm
  for (let i = 0; i < 5; i++) {
    for (const s of senders) {
      for (let j = 0; j < BURST / 10; j++) {
        void s.emit('m.evt.v1', { i: j });
      }
    }
  }

  const samples = new Array<number>(RUNS);
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    for (const s of senders) {
      for (let j = 0; j < BURST / senders.length; j++) {
        void s.emit('m.evt.v1', { i: j });
      }
    }
    samples[run] = (performance.now() - start) * 1e6; // ns per burst
  }
  samples.sort((a, b) => a - b);

  console.log(`  runs      : ${RUNS}`);
  console.log(`  burst     : ${BURST} emits per run (10 concurrent senders)`);
  console.log(`  p50 burst : ${fmtNs(percentile(samples, 50))}  → ~${fmtNs(percentile(samples, 50) / BURST)}/emit`);
  console.log(`  p95 burst : ${fmtNs(percentile(samples, 95))}  → ~${fmtNs(percentile(samples, 95) / BURST)}/emit`);
  console.log(`  p99 burst : ${fmtNs(percentile(samples, 99))}  → ~${fmtNs(percentile(samples, 99) / BURST)}/emit`);
  console.log(`  max burst : ${fmtNs(samples[samples.length - 1]!)}`);
  console.log('');

  destroyBroker();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
