/**
 * 07 · Backpressure overhead
 *
 * Backpressure strategies wrap the handler. Even when the strategy is
 * inactive (no throttle window elapsed, no rate limit hit), the wrapper is
 * still on the hot path. Measure the delta vs a plain handler.
 *
 * Throttle: has a timer branch every call.
 * Debounce: schedules a timer per call.
 * Rate limit: bookkeeping + count-window check.
 */

import type { Client } from '../src/core/client/Client.types';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

function scenario(setupReceiver: (r: Client<T, P>) => void) {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      setupReceiver(createClient<T, P>('receiver'));
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

  const cases: Array<[string, (r: Client<T, P>) => void]> = [
    ['no backpressure (baseline)', (r) => r.on('m.evt.v1', () => {})],
    [
      'throttle 100ms',
      (r) =>
        r.on('m.evt.v1', () => {}, {
          backpressure: { throttle: 100 },
        }),
    ],
    [
      'debounce 100ms',
      (r) =>
        r.on('m.evt.v1', () => {}, {
          backpressure: { debounce: 100 },
        }),
    ],
    [
      'rateLimit 1000/s',
      (r) =>
        r.on('m.evt.v1', () => {}, {
          backpressure: { rateLimit: { max: 1000, window: 1000 } },
        }),
    ],
  ];

  for (const [label, setup] of cases) {
    const sc = scenario(setup);
    bench.add(label, sc.fn, {
      beforeAll: sc.beforeAll,
      afterAll: sc.afterAll,
    });
  }

  await runSuite('07 · Backpressure overhead per emit', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
