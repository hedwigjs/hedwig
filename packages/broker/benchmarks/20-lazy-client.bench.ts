/**
 * 20 · SDK lazy client — queue and flush
 *
 * `createClient()` from `@hedwigjs/client` before the host called
 * `initBroker()` returns a lazy proxy: subscriptions are recorded, emits
 * and requests are queued (bounded at `DEFAULT_QUEUE_LIMIT`), and
 * everything is bound and flushed in order when the runtime registers.
 * This is the boot path of every module that loads before the shell, so
 * what it costs decides whether the SDK can stay the default.
 *
 * Each case is the full cycle — create a lazy client, queue N emits,
 * `initBroker()`, wait for the flush. Read N = 0 as the baseline: the
 * difference is what the queue and the flush actually cost.
 *
 * Node has no `EventTarget` on `globalThis`, so the SDK would fall back to
 * a 50 ms polling timer and we would be timing `setInterval`. The shim
 * below installs the browser shape the SDK is written for.
 */

// The SDK is imported from source, like the runtime is: a built
// `@hedwigjs/client` bakes `MIN_RUNTIME` from the release it shipped with
// and would refuse the source runtime, which reports `0.0.0-dev`. Both
// copies find each other through `Symbol.for`, so the handle is shared.
import {
  createClient as sdkCreateClient,
  DEFAULT_QUEUE_LIMIT,
} from '../../client/src/index';
import { createClient, destroyBroker, initBroker } from '../src/facade';
import { newBench, runSuite, SILENT_LOGGER } from './harness';

const bus = new EventTarget();
Object.assign(globalThis, {
  addEventListener: bus.addEventListener.bind(bus),
  removeEventListener: bus.removeEventListener.bind(bus),
  dispatchEvent: bus.dispatchEvent.bind(bus),
});

type T = 'm.evt.v1';
type P = { 'm.evt.v1': { i: number } };

/**
 * The bind and the flush run synchronously inside `initBroker`'s
 * `hedwig:runtime-ready` dispatch; this only drains the microtasks the
 * replayed emits resolve on. A `setTimeout` here would cost ~1.3 ms and
 * bury the thing we are measuring.
 */
const settled = () => Promise.resolve();

function lazy(queued: number) {
  let seq = 0;
  return async () => {
    destroyBroker();
    const client = sdkCreateClient<T, P>(`m-${++seq}`);
    client.on('m.evt.v1', () => {});
    for (let i = 0; i < queued; i++) void client.emit('m.evt.v1', { i });
    initBroker<T, P>({ logger: SILENT_LOGGER });
    await settled();
  };
}

/** Reference: the runtime is already there, so no proxy is involved. */
function eager() {
  let seq = 0;
  return async () => {
    destroyBroker();
    initBroker<T, P>({ logger: SILENT_LOGGER });
    const client = createClient<T, P>(`m-${++seq}`);
    client.on('m.evt.v1', () => {});
    await settled();
  };
}

async function run() {
  const bench = newBench();

  bench.add('runtime first — createClient, no queue', eager());
  bench.add('lazy client, 0 queued (baseline)', lazy(0));
  bench.add('lazy client, 1 queued emit', lazy(1));
  bench.add('lazy client, 16 queued emits', lazy(16));
  bench.add(
    `lazy client, ${DEFAULT_QUEUE_LIMIT} queued emits (queue full)`,
    lazy(DEFAULT_QUEUE_LIMIT),
  );

  await runSuite('20 · SDK lazy client — queue and flush', bench);
  destroyBroker();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
