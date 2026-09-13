import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import { RoutingReason } from './routing/RoutingResult';
import type { BridgeTransport } from './bridge/Bridge.types';
import type { BrokerLogger } from './logger/BrokerLogger.types';

/**
 * Minimum bridge safety (step 1 of the v4 plan):
 *  - a request never crosses a bridge;
 *  - inbound frames are validated field by field;
 *  - `allowedSources` gates the claimed source.
 */

type Topics = 'a.v1' | 'b.v1';
type Payloads = { 'a.v1': { n: number }; 'b.v1': { n: number } };

function quietLogger(): BrokerLogger & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    warn: (e, m) => {
      calls.push([e, m]);
    },
    error: (e, m) => {
      calls.push([e, m]);
    },
  };
}

function transportWithInbound() {
  let inbound: ((data: unknown) => void) | null = null;
  const transport: BridgeTransport = {
    send: jest.fn(),
    onMessage: jest.fn((cb) => {
      inbound = cb;
      return () => {};
    }),
    destroy: jest.fn(),
  };
  return { transport, fire: (data: unknown) => inbound!(data) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('requests never cross a bridge', () => {
  test('a multicast matching the forward pattern is sent, a unicast on the same topic is not', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: quietLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', () => 'ok');
    const { transport } = transportWithInbound();
    core.addBridge('wire', { transport, forward: ['a.*'] });

    await sender.emit('a.v1', { n: 1 });
    expect(transport.send).toHaveBeenCalledTimes(1);

    const result = await sender.request('receiver', 'a.v1', { n: 2 });
    expect(result.status).toBe('ACK');
    expect(transport.send).toHaveBeenCalledTimes(1); // unchanged
    core.destroy();
  });

  test('a unicast to an unregistered recipient is NACK NOT_SUBSCRIBED and nothing leaves the realm', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: quietLogger() });
    const sender = new BrokerClient('sender', core);
    const { transport } = transportWithInbound();
    core.addBridge('wire', { transport, forward: ['a.*'] });

    const result = await sender.request('remote-service', 'a.v1', { n: 1 });

    expect(result.reason).toBe(RoutingReason.NOT_SUBSCRIBED);
    expect(transport.send).not.toHaveBeenCalled();
    core.destroy();
  });
});

describe('inbound frame validation', () => {
  test.each([
    ['not an object', 'nope'],
    ['null', null],
    ['missing topic', { source: 'x', target: '*', data: {} }],
    ['empty topic', { topic: '', source: 'x', target: '*', data: {} }],
    ['missing source', { topic: 'a.v1', target: '*', data: {} }],
    ['numeric source', { topic: 'a.v1', source: 5, target: '*', data: {} }],
    ['missing target', { topic: 'a.v1', source: 'x', data: {} }],
    ['missing data', { topic: 'a.v1', source: 'x', target: '*' }],
    ['invalid JSON string', '{not json'],
  ])('%s → dropped as MALFORMED, never reaches hooks or handlers', async (_label, frame) => {
    const logger = quietLogger();
    const core = new BrokerCore<Topics, Payloads>({ logger });
    const receiver = new BrokerClient('receiver', core);
    const handler = jest.fn();
    receiver.on('a.v1', handler);
    const beforeSend = jest.fn(() => ({ allowed: true as const }));
    core.useBeforeSendHook(beforeSend);
    const invalid: unknown[] = [];
    core.$systemEvents.on('bridge.message.invalid', (p) => invalid.push(p));
    const { transport, fire } = transportWithInbound();
    core.addBridge('wire', { transport, forward: ['a.*'] });

    fire(frame);
    await tick();

    expect(handler).not.toHaveBeenCalled();
    expect(beforeSend).not.toHaveBeenCalled();
    expect(invalid).toEqual([expect.objectContaining({ bridgeId: 'wire', reason: 'MALFORMED' })]);
    expect(logger.calls).toContainEqual([
      'bridge.message.invalid',
      expect.objectContaining({ bridgeId: 'wire', reason: 'MALFORMED' }),
    ]);
    core.destroy();
  });

  test('a well-formed frame (data: null allowed) is injected with fromExternal', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: quietLogger() });
    const receiver = new BrokerClient('receiver', core);
    const handler = jest.fn();
    receiver.on('a.v1', handler);
    const { transport, fire } = transportWithInbound();
    core.addBridge('wire', { transport, forward: ['a.*'] });

    fire({ topic: 'a.v1', source: 'peer', target: '*', data: null });
    await tick();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ source: 'peer', data: null, fromExternal: true }),
    );
    core.destroy();
  });

  test('a frame on a topic outside the forward patterns is ignored silently (not an error)', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: quietLogger() });
    const invalid = jest.fn();
    core.$systemEvents.on('bridge.message.invalid', invalid);
    const { transport, fire } = transportWithInbound();
    core.addBridge('wire', { transport, forward: ['a.*'] });

    fire({ topic: 'b.v1', source: 'peer', target: '*', data: {} });
    await tick();

    expect(invalid).not.toHaveBeenCalled();
    core.destroy();
  });
});

describe('allowedSources', () => {
  test('a frame whose source is not listed is dropped as SOURCE_NOT_ALLOWED with the claimed source', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: quietLogger() });
    const receiver = new BrokerClient('receiver', core);
    const handler = jest.fn();
    receiver.on('a.v1', handler);
    const invalid: unknown[] = [];
    core.$systemEvents.on('bridge.message.invalid', (p) => invalid.push(p));
    const { transport, fire } = transportWithInbound();
    core.addBridge('wire', { transport, forward: ['a.*'], allowedSources: ['backend'] });

    fire({ topic: 'a.v1', source: 'menu', target: '*', data: { n: 1 } }); // impersonation attempt
    fire({ topic: 'a.v1', source: 'backend', target: '*', data: { n: 2 } });
    await tick();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].source).toBe('backend');
    expect(invalid).toEqual([
      expect.objectContaining({
        bridgeId: 'wire',
        reason: 'SOURCE_NOT_ALLOWED',
        source: 'menu',
        topic: 'a.v1',
      }),
    ]);
    core.destroy();
  });

  test('without allowedSources any source is accepted (unchanged behaviour)', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: quietLogger() });
    const receiver = new BrokerClient('receiver', core);
    const handler = jest.fn();
    receiver.on('a.v1', handler);
    const { transport, fire } = transportWithInbound();
    core.addBridge('wire', { transport, forward: ['a.*'] });

    fire({ topic: 'a.v1', source: 'anyone', target: '*', data: {} });
    await tick();

    expect(handler).toHaveBeenCalledTimes(1);
    core.destroy();
  });
});
