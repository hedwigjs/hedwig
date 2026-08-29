/**
 * 06 · Subscribe / unsubscribe cost
 *
 * HMR and React re-mount scenarios churn subscriptions constantly. Ideal
 * broker: creating a subscription (hook check, wrap, index update, emit
 * system event) is cheap and predictable. Big spikes here = long-tail UI
 * jank when a screen full of components remounts at once.
 *
 * We measure three cycles:
 *  - subscribe + immediate off (typical React effect cleanup)
 *  - subscribe with backpressure wrapper
 *  - createClient + subscribe + destroy client (full HMR shape)
 */

import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite, SILENT_LOGGER } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

async function run() {
  destroyBroker();
  // Silent logger: HMR-cycle case intentionally re-creates the same client id,
  // which fires an expected `facade.createClient.reset` warning every
  // iteration. That's harmless spam in a bench context.
  initBroker<T, P>({ logger: SILENT_LOGGER });
  const c = createClient<T, P>('bench-target');

  const bench = newBench();

  bench.add('subscribe + immediate off', () => {
    const off = c.on('m.evt.v1', () => {
      /* no-op */
    });
    off();
  });

  bench.add('subscribe (throttle backpressure) + off', () => {
    const off = c.on(
      'm.evt.v1',
      () => {
        /* no-op */
      },
      { backpressure: { throttle: 100 } },
    );
    off();
  });

  bench.add('createClient → subscribe → destroy (HMR cycle)', () => {
    const client = createClient<T, P>('churn-client');
    const off = client.on('m.evt.v1', () => {
      /* no-op */
    });
    off();
    client.destroy();
  });

  await runSuite('06 · Subscribe / unsubscribe / HMR churn', bench);
  destroyBroker();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
