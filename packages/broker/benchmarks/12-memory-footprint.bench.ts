/**
 * 12 · Memory footprint
 *
 * Long-running SPAs accumulate subscriptions as pages/mfe are visited.
 * Broker's memory should grow linearly and modestly per subscription.
 * Big regressions here = leak or oversized wrapper closures.
 *
 * Uses `process.memoryUsage().heapUsed` with `--expose-gc` + manual gc to
 * make the delta credible. Falls back to a warning if gc is unavailable.
 */

import { createClient, destroyBroker, initBroker } from '../src/facade';
import { fmtBytes } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

function forceGc() {
  if (typeof global.gc === 'function') {
    global.gc();
    global.gc();
  }
}

function heap(): number {
  return process.memoryUsage().heapUsed;
}

function measure(subs: number) {
  destroyBroker();
  initBroker<T, P>();

  // Warm & baseline
  const carrier = createClient<T, P>('carrier');
  void carrier;
  forceGc();
  const before = heap();

  // Actual population
  for (let i = 0; i < subs; i++) {
    const c = createClient<T, P>(`c-${i}`);
    c.on('m.evt.v1', () => {});
  }
  forceGc();
  const after = heap();

  const delta = after - before;
  destroyBroker();
  return { delta, perSub: delta / subs };
}

async function run() {
  console.log('\n══ 12 · Memory footprint per subscription ══\n');
  if (typeof global.gc !== 'function') {
    console.log(
      '  ⚠  gc() unavailable — run with `node --expose-gc` for reliable numbers.',
    );
  }

  const scenarios = [1_000, 10_000, 50_000];
  for (const n of scenarios) {
    const { delta, perSub } = measure(n);
    console.log(
      `  ${n.toString().padStart(6)} subscriptions → heap Δ ${fmtBytes(delta).padStart(11)}  ·  ${fmtBytes(perSub)} / sub`,
    );
  }
  console.log('');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
