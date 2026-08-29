/**
 * 02 · Emit latency percentiles
 *
 * Per-emit latency distribution — p50/p95/p99 matter more than average for
 * UI predictability. Big p99 tail = jank risk under bursty producers.
 *
 * Sampled through the harness (not tinybench) because tinybench reports
 * throughput-normalized latency; here we want raw wall-clock per emit.
 */

import { createClient, destroyBroker, initBroker } from '../src/facade';
import { fmtNs, percentile, sampleLatencies } from './harness';

async function run() {
  console.log('\n══ 02 · Emit latency percentiles (1 subscriber) ══\n');

  destroyBroker();
  initBroker();
  const sender = createClient<'m.evt.v1', { 'm.evt.v1': { i: number } }>(
    'sender',
  );
  const receiver = createClient<'m.evt.v1', { 'm.evt.v1': { i: number } }>(
    'receiver',
  );
  receiver.on('m.evt.v1', () => {
    /* no-op */
  });

  const samples = await sampleLatencies(
    () => {
      void sender.emit('m.evt.v1', { i: 1 });
    },
    100_000,
  );

  console.log(`  samples : ${samples.length.toLocaleString()}`);
  console.log(`  p50     : ${fmtNs(percentile(samples, 50))}`);
  console.log(`  p95     : ${fmtNs(percentile(samples, 95))}`);
  console.log(`  p99     : ${fmtNs(percentile(samples, 99))}`);
  console.log(`  p99.9   : ${fmtNs(percentile(samples, 99.9))}`);
  console.log(`  max     : ${fmtNs(samples[samples.length - 1]!)}`);
  console.log('');

  destroyBroker();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
