/**
 * 19 · `maxBytes` on an inbound frame
 *
 * A remote client with `maxBytes` drops frames over the limit before any
 * hook runs. How it learns the size depends on the transport: a text one
 * (WebSocket, SSE) reports the wire length through `TransportFrameMeta`,
 * so the check is a number comparison. A structured-clone transport
 * (postMessage, MessagePort, BroadcastChannel) reports nothing, so the
 * runtime has to measure the frame itself — that measurement is the cost
 * this file isolates, and it scales with the payload.
 *
 * Read the delta against the no-limit baseline on the same payload size.
 */

import type {
  Transport,
  TransportFrameMeta,
} from '../src/core/transport/Transport.types';
import { createClient, destroyBroker, getBroker, initBroker } from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'm.evt.v1';
type P = { 'm.evt.v1': Record<string, unknown> };

const PEER_ORIGIN = 'peer-realm';
const LIMIT = 1024 * 1024;

/** Hands frames over as objects, with no size hint — the postMessage shape. */
class ClonePeer implements Transport {
  #cb: ((frame: unknown, meta?: TransportFrameMeta) => void) | null = null;
  send(): void {}
  onMessage(cb: (frame: unknown, meta?: TransportFrameMeta) => void) {
    this.#cb = cb;
    return () => {
      this.#cb = null;
    };
  }
  destroy(): void {
    this.#cb = null;
  }
  inject(frame: unknown): void {
    this.#cb?.(frame);
  }
}

/** Reports the wire length it already knows — the WebSocket / SSE shape. */
class TextPeer implements Transport {
  #cb: ((frame: unknown, meta?: TransportFrameMeta) => void) | null = null;
  send(): void {}
  onMessage(cb: (frame: unknown, meta?: TransportFrameMeta) => void) {
    this.#cb = cb;
    return () => {
      this.#cb = null;
    };
  }
  destroy(): void {
    this.#cb = null;
  }
  inject(frame: unknown, bytes: number): void {
    this.#cb?.(frame, { bytes });
  }
}

const small = { sku: 'ABC-123', qty: 2 };
/** ~4 KB once serialised. */
const large = {
  rows: Array.from({ length: 100 }, (_, i) => ({
    sku: `SKU-${i}`,
    qty: i,
    note: 'lorem ipsum dolor sit',
  })),
};

function frameFor(data: object, id: number) {
  return {
    v: 1,
    id: `w-${id}`,
    origin: PEER_ORIGIN,
    kind: 'event',
    topic: 'm.evt.v1',
    source: 'peer',
    target: '*',
    data,
    timestamp: Date.now(),
  };
}

function scenario(
  kind: 'clone' | 'text',
  maxBytes: number | undefined,
  data: object,
) {
  let peer: ClonePeer | TextPeer | null = null;
  let bytes = 0;
  let i = 0;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      createClient<T, P>('receiver').on('m.evt.v1', () => {});
      peer = kind === 'clone' ? new ClonePeer() : new TextPeer();
      bytes = JSON.stringify(frameFor(data, 0)).length;
      getBroker<T, P>().createRemoteClient('peer', {
        transport: peer,
        accepts: ['m.evt.v1'],
        ...(maxBytes === undefined ? {} : { maxBytes }),
      });
    },
    fn: () => {
      const frame = frameFor(data, ++i);
      if (peer instanceof TextPeer) peer.inject(frame, bytes);
      else (peer as ClonePeer).inject(frame);
    },
    afterAll: () => {
      peer = null;
      destroyBroker();
    },
  };
}

async function run() {
  const bench = newBench();

  const cases: Array<[string, 'clone' | 'text', number | undefined, object]> = [
    ['clone transport · no maxBytes · small', 'clone', undefined, small],
    ['clone transport · maxBytes · small', 'clone', LIMIT, small],
    ['text transport · maxBytes (bytes reported) · small', 'text', LIMIT, small],
    ['clone transport · no maxBytes · ~4 KB', 'clone', undefined, large],
    ['clone transport · maxBytes · ~4 KB', 'clone', LIMIT, large],
    ['text transport · maxBytes (bytes reported) · ~4 KB', 'text', LIMIT, large],
  ];

  for (const [name, kind, maxBytes, data] of cases) {
    const sc = scenario(kind, maxBytes, data);
    bench.add(name, sc.fn, { beforeAll: sc.beforeAll, afterAll: sc.afterAll });
  }

  await runSuite('19 · maxBytes on an inbound frame', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
