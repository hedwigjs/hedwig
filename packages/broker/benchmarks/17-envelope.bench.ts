/**
 * 17 · Wire envelope v1 — build and parse
 *
 * Every frame that crosses a transport is built by `buildFrame` on the way
 * out and checked by `parseFrame` on the way in. `parseFrame` is a
 * structural check equivalent to the shipped JSON Schema, so this is the
 * per-frame ingress tax the runtime pays before any hook runs — and the
 * reason the runtime does not embed a schema validator.
 *
 * A text transport (WebSocket, SSE) hands over a JSON string, so its case
 * carries the `JSON.parse` too; structured-clone transports hand over an
 * object. `JSON.stringify` is listed as the encode reference an outbound
 * text transport adds on top of `buildFrame`.
 */

import type { Message } from '../src/core/types';
import { buildFrame, parseFrame } from '../src/core/wire/envelope';
import { newBench, runSuite } from './harness';

const ORIGIN = 'this-realm';

const event: Message = {
  id: 'm-1',
  topic: 'cart.snapshot.v1',
  source: 'cart-mfe',
  target: '*',
  data: { items: [{ sku: 'a', qty: 1 }], total: 199 },
  timestamp: Date.now(),
};

const unicast: Message = { ...event, id: 'm-2', target: 'cart-runtime' };

const eventFrame = buildFrame(event, ORIGIN);
const requestFrame = buildFrame(unicast, ORIGIN, {
  correlationId: unicast.id,
  deadline: Date.now() + 5_000,
});
const responseFrame = {
  v: 1,
  id: 'p-1',
  origin: 'peer-realm',
  kind: 'response',
  correlationId: 'm-2',
  topic: 'cart.snapshot.v1',
  source: 'cart-runtime',
  target: 'cart-mfe',
  status: 'ACK',
  reason: 'DELIVERED',
  data: { ok: true },
  timestamp: Date.now(),
};

const eventText = JSON.stringify(eventFrame);
// `target` missing — rejected as MALFORMED before anything else runs.
const malformed = { ...eventFrame, target: undefined };

async function run() {
  const bench = newBench();

  bench.add('buildFrame (event)', () => {
    buildFrame(event, ORIGIN);
  });
  bench.add('buildFrame (request + deadline)', () => {
    buildFrame(unicast, ORIGIN, {
      correlationId: unicast.id,
      deadline: Date.now() + 5_000,
    });
  });
  bench.add('JSON.stringify (text transport encode)', () => {
    JSON.stringify(eventFrame);
  });
  bench.add('parseFrame (object · event)', () => {
    parseFrame(eventFrame);
  });
  bench.add('parseFrame (object · request)', () => {
    parseFrame(requestFrame);
  });
  bench.add('parseFrame (object · response)', () => {
    parseFrame(responseFrame);
  });
  bench.add('parseFrame (JSON string · text transport)', () => {
    parseFrame(eventText);
  });
  bench.add('parseFrame (rejected · MALFORMED)', () => {
    parseFrame(malformed);
  });

  await runSuite('17 · Wire envelope v1 — build and parse', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
