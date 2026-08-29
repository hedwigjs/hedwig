/**
 * 13 · DevTools attach overhead
 *
 * DevTools wires beforeSend / afterSend / systemEvents listeners. Even when
 * the UI is invisible, its listeners tax every emit. We simulate a
 * DevTools-shaped attachment (hook + system-events subscriber) and measure
 * the delta vs a plain broker.
 *
 * NOTE: we can't import @hedwigjs/devtools here (would create a cycle in
 * benchmarks), so we approximate its cost with equivalent listeners.
 */

import type { Client } from '../src/core/client/Client.types';
import {
  createClient,
  destroyBroker,
  getBroker,
  initBroker,
} from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

function scenario(attached: boolean) {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      createClient<T, P>('receiver').on('m.evt.v1', () => {});
      if (attached) {
        const broker = getBroker<T, P>();
        broker.useBeforeSendHook(() => ({ allowed: true }));
        broker.useAfterSendHook(() => {});
        broker.$systemEvents.on('subscription.added', () => {});
        broker.$systemEvents.on('subscription.removed', () => {});
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
  const off = scenario(false);
  const on = scenario(true);

  bench.add('emit (no observer)', off.fn, {
    beforeAll: off.beforeAll,
    afterAll: off.afterAll,
  });
  bench.add('emit + DevTools-shape observer', on.fn, {
    beforeAll: on.beforeAll,
    afterAll: on.afterAll,
  });

  await runSuite('13 · DevTools attach overhead', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
