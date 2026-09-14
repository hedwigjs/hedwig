/**
 * 16 · Requests across the wire
 *
 * `client.request(remote.id, …)` leaves as a `kind: 'request'` frame with a
 * correlationId and an absolute deadline; the pending entry on the remote
 * client settles when a matching `kind: 'response'` frame arrives. The
 * reverse direction — a request injected by the peer, routed to the named
 * local client and always answered — is the other half of that path.
 *
 * Both transports here answer synchronously, so the delta over a local
 * `request()` is what the runtime's wire path costs when the wire itself is
 * free. A real socket adds its own latency on top of this.
 */

import type { Client } from '../src/core/client/Client.types';
import type { Transport } from '../src/core/transport/Transport.types';
import {
  createClient,
  destroyBroker,
  getBroker,
  initBroker,
} from '../src/facade';
import { newBench, runSuite } from './harness';

type T = 'q.v1';
type P = { 'q.v1': { i: number } };

/** A peer stamps its own realm id; our own `origin` would be dropped as an echo. */
const PEER_ORIGIN = 'peer-realm';

/** Answers every outbound `request` frame with an ACK response, inline. */
class RespondingTransport implements Transport {
  #cb: ((frame: unknown) => void) | null = null;

  send(frame: unknown): void {
    const f = frame as {
      kind?: string;
      id?: string;
      correlationId?: string;
      topic?: string;
      source?: string;
      target?: string;
    };
    if (f.kind !== 'request') return;
    this.#cb?.({
      v: 1,
      id: `resp-${f.id}`,
      origin: PEER_ORIGIN,
      kind: 'response',
      correlationId: f.correlationId,
      topic: f.topic,
      // The responder is the remote the request was addressed to.
      source: f.target,
      target: f.source,
      status: 'ACK',
      reason: 'DELIVERED',
      data: { answer: 42 },
      timestamp: Date.now(),
    });
  }

  onMessage(cb: (frame: unknown) => void) {
    this.#cb = cb;
    return () => {
      this.#cb = null;
    };
  }

  destroy(): void {
    this.#cb = null;
  }
}

/** Lets the bench inject inbound frames and observe the response going out. */
class InboundTransport implements Transport {
  #cb: ((frame: unknown) => void) | null = null;
  onResponse: (() => void) | null = null;

  send(frame: unknown): void {
    if ((frame as { kind?: string }).kind === 'response') this.onResponse?.();
  }

  onMessage(cb: (frame: unknown) => void) {
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

function local() {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      createClient<T, P>('responder').on('q.v1', () => ({ answer: 42 }));
    },
    fn: async () => {
      await sender!.request('responder', 'q.v1', { i: 1 });
    },
    afterAll: () => {
      sender = null;
      destroyBroker();
    },
  };
}

function outbound() {
  let sender: Client<T, P> | null = null;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      sender = createClient<T, P>('sender');
      getBroker<T, P>().createRemoteClient('peer', {
        transport: new RespondingTransport(),
        accepts: ['q.v1'],
      });
    },
    fn: async () => {
      await sender!.request('peer', 'q.v1', { i: 1 });
    },
    afterAll: () => {
      sender = null;
      destroyBroker();
    },
  };
}

function inbound() {
  let transport: InboundTransport | null = null;
  let seq = 0;
  return {
    beforeAll: () => {
      destroyBroker();
      initBroker<T, P>();
      createClient<T, P>('responder').on('q.v1', () => ({ answer: 42 }));
      transport = new InboundTransport();
      getBroker<T, P>().createRemoteClient('peer', {
        transport,
        accepts: ['q.v1'],
      });
    },
    fn: async () => {
      const id = `q-${++seq}`;
      await new Promise<void>((resolve) => {
        transport!.onResponse = resolve;
        transport!.inject({
          v: 1,
          id,
          origin: PEER_ORIGIN,
          kind: 'request',
          topic: 'q.v1',
          source: 'peer',
          target: 'responder',
          data: { i: 1 },
          correlationId: id,
          deadline: Date.now() + 5_000,
          timestamp: Date.now(),
        });
      });
    },
    afterAll: () => {
      transport = null;
      destroyBroker();
    },
  };
}

async function run() {
  const bench = newBench();

  const l = local();
  const o = outbound();
  const i = inbound();

  bench.add('request → local client (baseline)', l.fn, {
    beforeAll: l.beforeAll,
    afterAll: l.afterAll,
  });
  bench.add('request → remote, peer answers', o.fn, {
    beforeAll: o.beforeAll,
    afterAll: o.afterAll,
  });
  bench.add('request from remote → local handler → response', i.fn, {
    beforeAll: i.beforeAll,
    afterAll: i.afterAll,
  });

  await runSuite('16 · Requests across the wire', bench);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
