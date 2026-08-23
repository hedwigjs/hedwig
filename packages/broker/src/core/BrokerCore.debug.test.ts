import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';

/**
 * Tests for `broker.$debug.send()` — the injection channel used by
 * DevTools' Debug tab and integration tests. Runs the full pipeline
 * (routing / hooks / bridges) with an arbitrary `source` and no client
 * registry side effects; messages are tagged `synthetic: true`.
 */

type Topics = 'x.v1' | 'ping.v1';
type Payloads = {
  'x.v1': { value: number };
  'ping.v1': { echo: string };
};

describe('BrokerCore.$debug.send', () => {
  let core: BrokerCore<Topics, Payloads>;

  beforeEach(() => {
    core = new BrokerCore<Topics, Payloads>();
  });

  afterEach(() => {
    core.destroy();
  });

  test('multicast: reaches every subscriber and tags message synthetic', async () => {
    const a = new BrokerClient<Topics, Payloads>('a', core);
    const b = new BrokerClient<Topics, Payloads>('b', core);

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    a.on('x.v1', (msg) => receivedA.push(msg));
    b.on('x.v1', (msg) => receivedB.push(msg));

    const result = await core.$debug.send('anonymous-tester', 'x.v1', '*', { value: 7 });

    expect(result.status).toBe('ACK');
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect((receivedA[0] as { synthetic?: boolean }).synthetic).toBe(true);
    expect((receivedB[0] as { source: string }).source).toBe('anonymous-tester');
  });

  test('unicast: targets one recipient and captures its return value', async () => {
    new BrokerClient<Topics, Payloads>('sender-noop', core);
    const responder = new BrokerClient<Topics, Payloads>('responder', core);
    responder.on('ping.v1', (msg) => `echo:${msg.data.echo}`);

    const result = await core.$debug.send<'ping.v1', string>(
      'devtools',
      'ping.v1',
      'responder',
      { echo: 'hi' },
    );

    expect(result.status).toBe('ACK');
    expect(result.data).toBe('echo:hi');
  });

  test('spoofed source that matches a real subscriber is EXCLUDED from own multicast', async () => {
    // Broker excludes sender from own multicast — spoofed source must
    // behave the same way, otherwise debug traffic behaves differently
    // from real traffic and the tool lies.
    const receiver = new BrokerClient<Topics, Payloads>('receiver', core);
    const impersonated = new BrokerClient<Topics, Payloads>('impersonated', core);

    const gotOnReceiver: unknown[] = [];
    const gotOnImpersonated: unknown[] = [];
    receiver.on('x.v1', (m) => gotOnReceiver.push(m));
    impersonated.on('x.v1', (m) => gotOnImpersonated.push(m));

    await core.$debug.send('impersonated', 'x.v1', '*', { value: 1 });

    expect(gotOnReceiver).toHaveLength(1);
    expect(gotOnImpersonated).toHaveLength(0);
  });

  test('does NOT touch the client registry of the spoofed identity', async () => {
    // Regression guard: naive `createClient('impersonated')` from a debug
    // tool would call resetClient() and wipe the real client's
    // subscriptions. $debug.send must not go through client registry.
    const impersonated = new BrokerClient<Topics, Payloads>('impersonated', core);
    const gotOwnEmits: unknown[] = [];
    impersonated.on('ping.v1', (m) => gotOwnEmits.push(m));

    await core.$debug.send('impersonated', 'x.v1', '*', { value: 1 });

    // Impersonated's own subscription must still be alive.
    const infoAfter = core.inspect
      .getClients()
      .find((c) => c.id === 'impersonated');
    expect(infoAfter?.subscriptions.map((s) => s.topic)).toContain('ping.v1');
    expect(gotOwnEmits).toEqual([]);

    // And it still receives normal events for its real subscriptions:
    const sender = new BrokerClient<Topics, Payloads>('other', core);
    await sender.emit('ping.v1', { echo: 'real' });
    expect(gotOwnEmits).toHaveLength(1);
  });

  test('afterSend hook sees the synthetic flag on the message', async () => {
    const seen: Array<{ synthetic?: boolean; source: string }> = [];
    core.useAfterSendHook((message) => {
      seen.push({ synthetic: message.synthetic, source: message.source });
    });

    await core.$debug.send('devtools', 'x.v1', '*', { value: 1 });
    // For contrast, a real emit shouldn't be marked synthetic.
    const real = new BrokerClient<Topics, Payloads>('real-sender', core);
    await real.emit('x.v1', { value: 2 });

    expect(seen).toEqual([
      { synthetic: true, source: 'devtools' },
      { synthetic: undefined, source: 'real-sender' },
    ]);
  });

  test('beforeSend hook can reject a synthetic message', async () => {
    core.useBeforeSendHook((message) => {
      if (message.synthetic) {
        return { allowed: false, message: 'synthetic events blocked' };
      }
      return { allowed: true };
    });

    const result = await core.$debug.send('devtools', 'x.v1', '*', { value: 1 });
    expect(result.status).toBe('NACK');
  });

  test('records to history when options.history is true, like real emits', async () => {
    const withHistory = new BrokerCore<Topics, Payloads>({
      history: { enabled: true, maxSize: 10 },
    });

    await withHistory.$debug.send(
      'devtools',
      'x.v1',
      '*',
      { value: 42 },
      { history: true },
    );

    const historyEntries = withHistory.inspect.getHistory();
    expect(historyEntries).toHaveLength(1);
    expect(historyEntries[0]!.message.synthetic).toBe(true);
    expect(historyEntries[0]!.message.source).toBe('devtools');

    withHistory.destroy();
  });

  test('destroyed broker returns NACK(BROKER_DESTROYED)', async () => {
    core.destroy();
    const result = await core.$debug.send('devtools', 'x.v1', '*', { value: 1 });
    expect(result.status).toBe('NACK');
  });
});
