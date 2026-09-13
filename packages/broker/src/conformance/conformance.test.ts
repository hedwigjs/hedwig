import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { transportConformance, createMemoryTransportPair } from './index';
import type { TransportPair } from './index';
import { MessagePortTransport } from '../transports/MessagePortTransport';
import { BroadcastChannelTransport } from '../transports/BroadcastChannelTransport';
import { WebSocketTransport } from '../transports/WebSocketTransport';

/**
 * The kit against the reference pair and every built-in transport that can
 * form a pair in Node: MessagePort (MessageChannel), BroadcastChannel (two
 * channels on one name) and WebSocket (a `ws` server with our transport on
 * both ends). SSE and postMessage need a browser and are covered by the
 * e2e stand. A deliberately broken transport proves the kit fails.
 */

function suite(name: string, factory: () => TransportPair | Promise<TransportPair>) {
  describe(name, () => {
    for (const c of transportConformance(factory)) {
      test(c.name, c.run);
    }
  });
}

suite('memory pair (reference)', createMemoryTransportPair);

suite('message-port', () => {
  const { port1, port2 } = new MessageChannel();
  return { a: new MessagePortTransport(port1), b: new MessagePortTransport(port2) };
});

let channelSeq = 0;
suite('broadcast-channel', () => {
  const name = `conformance-${process.pid}-${++channelSeq}`;
  return { a: new BroadcastChannelTransport(name), b: new BroadcastChannelTransport(name) };
});

suite('websocket', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const { port } = wss.address() as AddressInfo;
  const serverSide = new Promise<import('ws').WebSocket>((r) => wss.once('connection', (s) => r(s)));
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const server = await serverSide;
  return {
    a: new WebSocketTransport(client),
    b: new WebSocketTransport(server as unknown as WebSocket),
    close: () => server.close(),
    dispose: () => new Promise<void>((r) => wss.close(() => r())),
  };
});

describe('the kit rejects a broken transport', () => {
  test('a transport that reorders frames fails the ordering case', async () => {
    const cases = transportConformance(() => {
      const pair = createMemoryTransportPair();
      const originalSend = pair.a.send.bind(pair.a);
      let n = 0;
      // Every other frame takes the slow lane: all arrive, not in order.
      pair.a.send = (frame) => {
        if (n++ % 2 === 0) setTimeout(() => originalSend(frame), 5);
        else originalSend(frame);
      };
      return pair;
    });
    const ordering = cases.find((c) => c.name.includes('order'))!;
    await expect(ordering.run()).rejects.toThrow(/out of order/);
  });

  test('a transport that keeps delivering after destroy fails the destroy case', async () => {
    const cases = transportConformance(() => {
      const pair = createMemoryTransportPair();
      pair.b.destroy = () => {};
      return pair;
    });
    const destroy = cases.find((c) => c.name.startsWith('destroy'))!;
    await expect(destroy.run()).rejects.toThrow(/destroyed transport/);
  });
});
