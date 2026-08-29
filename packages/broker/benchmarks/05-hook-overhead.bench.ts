/**
 * 05 · Hook chain overhead
 *
 * Extension hooks (`beforeSend` / `afterSend`) run inline in the emit
 * pipeline. Each additional hook is a function call; too many = pipeline
 * tax on every message. We measure emit throughput with 0/1/5/10 hooks
 * chained to show the marginal cost per hook.
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

function scenario(hookCount: number) {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      const broker = getBroker<T, P>();
      for (let i = 0; i < hookCount; i++) {
        broker.useBeforeSendHook(() => ({ allowed: true }));
      }
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

async function run() {
  const bench = newBench();

  for (const hooks of [0, 1, 5, 10]) {
    const sc = scenario(hooks);
    bench.add(`hooks=${hooks} (beforeSend chain)`, sc.fn, {
      beforeAll: sc.beforeAll,
      afterAll: sc.afterAll,
    });
  }

  await runSuite('05 · Hook chain overhead — 0/1/5/10 beforeSend hooks', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
