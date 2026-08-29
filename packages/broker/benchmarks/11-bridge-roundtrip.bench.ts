/**
 * 11 · Bridge round-trip (loopback transport)
 *
 * BroadcastChannel / postMessage bridges are the real-world way brokers talk
 * across contexts. We can't spin up a real BroadcastChannel in Node here,
 * but we CAN measure the bridge machinery itself with a synchronous
 * loopback transport — the delta over an in-process emit is the wire
 * overhead we'd add if the transport were free.
 *
 * The loopback transport plays two roles: it forwards outbound messages
 * back through the same bridge as inbound, so we see the full round-trip
 * (send → serialize → onMessage → inject → route).
 */

import type { BridgeTransport } from '../src/core/bridge/Bridge.types';
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

class LoopbackTransport implements BridgeTransport {
  #cb: ((data: unknown) => void) | null = null;
  send(data: unknown): void {
    this.#cb?.(data);
  }
  onMessage(cb: (data: unknown) => void) {
    this.#cb = cb;
    return () => {
      this.#cb = null;
    };
  }
  destroy(): void {
    this.#cb = null;
  }
}

class SinkTransport implements BridgeTransport {
  send(): void {}
  onMessage(): () => void {
    return () => {};
  }
  destroy(): void {}
}

function scenario(kind: 'plain' | 'outbound' | 'loopback') {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      createClient<T, P>('receiver').on('m.evt.v1', () => {});
      if (kind === 'outbound') {
        getBroker<T, P>().addBridge('sink', {
          transport: new SinkTransport(),
          forward: ['m.evt.v1'],
        });
      } else if (kind === 'loopback') {
        getBroker<T, P>().addBridge('loop', {
          transport: new LoopbackTransport(),
          forward: ['m.evt.v1'],
        });
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

  const plain = scenario('plain');
  const outbound = scenario('outbound');
  const loopback = scenario('loopback');

  bench.add('plain emit (no bridge, baseline)', plain.fn, {
    beforeAll: plain.beforeAll,
    afterAll: plain.afterAll,
  });
  bench.add('emit + bridge forward (outbound only)', outbound.fn, {
    beforeAll: outbound.beforeAll,
    afterAll: outbound.afterAll,
  });
  bench.add('emit + bridge loopback round-trip', loopback.fn, {
    beforeAll: loopback.beforeAll,
    afterAll: loopback.afterAll,
  });

  await runSuite('11 · Bridge round-trip (loopback transport)', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
