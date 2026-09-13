import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import { RoutingReason } from './routing/RoutingResult';
import type { BrokerLogger } from './logger/BrokerLogger.types';

/**
 * Semantics pinned in step 1 of the v4 plan:
 *  - guard hooks fail closed by default;
 *  - unicast bypasses backpressure and is always answered;
 *  - requests can time out;
 *  - `noLocal` is an option, not a hard-wired rule;
 *  - backpressure strategies isolate async handler rejections.
 */

type Topics = 'a.v1' | 'b.v1';
type Payloads = { 'a.v1': { n: number }; 'b.v1': { n: number } };

function recordingLogger(): BrokerLogger & { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    warn: (event, meta) => {
      calls.push(['warn', event, meta]);
    },
    error: (event, meta) => {
      calls.push(['error', event, meta]);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('guard hooks fail closed', () => {
  test('a throwing beforeSend hook denies the message (NACK HOOK_REJECTED) and reports hook.failed', async () => {
    const logger = recordingLogger();
    const core = new BrokerCore<Topics, Payloads>({ logger });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    const handler = jest.fn();
    receiver.on('a.v1', handler);

    const hookFailed: unknown[] = [];
    const rejected: unknown[] = [];
    core.$systemEvents.on('hook.failed', (p) => hookFailed.push(p));
    core.$systemEvents.on('message.rejected', (p) => rejected.push(p));
    core.useBeforeSendHook(() => {
      throw new Error('acl exploded');
    });

    const result = await sender.emit('a.v1', { n: 1 });

    expect(result.status).toBe('NACK');
    expect(result.reason).toBe(RoutingReason.HOOK_REJECTED);
    expect(result.message).toMatch(/fail closed/);
    expect(handler).not.toHaveBeenCalled();
    expect(hookFailed).toHaveLength(1);
    expect(hookFailed[0]).toEqual(
      expect.objectContaining({
        kind: 'beforeSend',
        failMode: 'closed',
        topic: 'a.v1',
        source: 'sender',
        messageId: expect.any(String),
      }),
    );
    expect(rejected).toHaveLength(1);
    expect(logger.calls).toContainEqual([
      'error',
      'hook.failed',
      expect.objectContaining({ kind: 'beforeSend', failMode: 'closed', topic: 'a.v1' }),
    ]);
    core.destroy();
  });

  test('a throwing onSubscribe hook denies the subscription: on() throws, subscription.rejected fires', () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const client = new BrokerClient('c', core);
    const rejected: unknown[] = [];
    core.$systemEvents.on('subscription.rejected', (p) => rejected.push(p));
    core.useOnSubscribeHook(() => {
      throw new Error('policy crashed');
    });

    expect(() => client.on('a.v1', () => {})).toThrow(/fail closed/);
    expect(rejected).toHaveLength(1);
    expect(core.inspect.getClients().find((c) => c.id === 'c')?.subscriptions).toEqual([]);
    core.destroy();
  });

  test('failMode: "open" restores the previous behaviour — the throwing hook is skipped', async () => {
    const core = new BrokerCore<Topics, Payloads>({
      logger: recordingLogger(),
      hooks: { failMode: 'open' },
    });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    const handler = jest.fn();
    receiver.on('a.v1', handler);
    const hookFailed = jest.fn();
    core.$systemEvents.on('hook.failed', hookFailed);
    core.useBeforeSendHook(() => {
      throw new Error('acl exploded');
    });

    const result = await sender.emit('a.v1', { n: 1 });

    expect(result.status).toBe('ACK');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(hookFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'beforeSend', failMode: 'open' }));
    core.destroy();
  });

  test('a throwing afterSend hook is isolated in both modes and reported as hook.failed', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', () => {});
    const hookFailed = jest.fn();
    core.$systemEvents.on('hook.failed', hookFailed);
    core.useAfterSendHook(() => {
      throw new Error('observer exploded');
    });

    const result = await sender.emit('a.v1', { n: 1 });

    expect(result.status).toBe('ACK');
    expect(hookFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'afterSend', topic: 'a.v1' }));
    core.destroy();
  });
});

describe('unicast bypasses backpressure', () => {
  test('request to a throttled subscription is answered every time with the handler result', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', (m) => ({ doubled: m.data.n * 2 }), { backpressure: { throttle: 10_000 } });

    const r1 = await sender.request<'a.v1', { doubled: number }>('receiver', 'a.v1', { n: 1 });
    const r2 = await sender.request<'a.v1', { doubled: number }>('receiver', 'a.v1', { n: 2 });

    expect(r1).toEqual(expect.objectContaining({ status: 'ACK', data: { doubled: 2 } }));
    expect(r2).toEqual(expect.objectContaining({ status: 'ACK', data: { doubled: 4 } }));
    core.destroy();
  });

  test('request to a rate-limited subscription is never dropped', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    const onDrop = jest.fn();
    receiver.on('a.v1', (m) => m.data.n, { backpressure: { rateLimit: { max: 1, window: 60_000 }, onDrop } });

    const results = await Promise.all([1, 2, 3].map((n) => sender.request('receiver', 'a.v1', { n })));

    expect(results.map((r) => r.data)).toEqual([1, 2, 3]);
    expect(onDrop).not.toHaveBeenCalled();
    core.destroy();
  });

  test('multicast on the same subscription is still shaped by the strategy', async () => {
    jest.useFakeTimers();
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    const seen: number[] = [];
    receiver.on('a.v1', (m) => seen.push(m.data.n), { backpressure: { throttle: 50 } });

    await sender.emit('a.v1', { n: 1 });
    await sender.emit('a.v1', { n: 2 });
    await sender.emit('a.v1', { n: 3 });
    expect(seen).toEqual([1]);
    jest.advanceTimersByTime(50);
    expect(seen).toEqual([1, 3]);

    jest.useRealTimers();
    core.destroy();
  });

  test('a second handler on a unicast pair is never invoked and is warned about once', async () => {
    const logger = recordingLogger();
    const core = new BrokerCore<Topics, Payloads>({ logger });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    const second = jest.fn(() => 'second');
    receiver.on('a.v1', () => 'first');
    receiver.on('a.v1', second);

    const r1 = await sender.request('receiver', 'a.v1', { n: 1 });
    const r2 = await sender.request('receiver', 'a.v1', { n: 2 });

    expect(r1.data).toBe('first');
    expect(r2.data).toBe('first');
    expect(second).not.toHaveBeenCalled();
    expect(logger.calls.filter(([, e]) => e === 'unicast.multiple_handlers')).toHaveLength(1);
    core.destroy();
  });
});

describe('request timeout', () => {
  test('resolves NACK TIMEOUT when the handler does not settle in time; handler is not cancelled', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    let finish!: (v: string) => void;
    let ran = false;
    receiver.on('a.v1', () => {
      ran = true;
      return new Promise<string>((r) => {
        finish = r;
      });
    });
    const afterSend = jest.fn();
    core.useAfterSendHook(afterSend);

    const result = await sender.request('receiver', 'a.v1', { n: 1 }, { timeout: 20 });

    expect(result.status).toBe('NACK');
    expect(result.reason).toBe(RoutingReason.TIMEOUT);
    expect(result.recipientId).toBe('receiver');
    expect(ran).toBe(true);
    expect(afterSend).toHaveBeenCalledTimes(1);
    expect(afterSend.mock.calls[0]![1].reason).toBe(RoutingReason.TIMEOUT);

    finish('late'); // completes on its own, nothing observes it, no unhandled rejection
    await tick();
    core.destroy();
  });

  test('resolves ACK with data when the handler settles in time', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', async (m) => {
      await tick();
      return m.data.n + 1;
    });

    const result = await sender.request('receiver', 'a.v1', { n: 1 }, { timeout: 500 });

    expect(result).toEqual(expect.objectContaining({ status: 'ACK', data: 2 }));
    core.destroy();
  });

  test('a late rejection after timeout is swallowed, not surfaced as unhandled', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    let fail!: (e: Error) => void;
    receiver.on('a.v1', () => new Promise((_, reject) => (fail = reject)));

    const result = await sender.request('receiver', 'a.v1', { n: 1 }, { timeout: 10 });
    expect(result.reason).toBe(RoutingReason.TIMEOUT);

    fail(new Error('too late'));
    await tick();
    core.destroy();
  });

  test('BrokerConfig.request.timeout applies as the default and per-call overrides it', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger(), request: { timeout: 10 } });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', () => new Promise((r) => setTimeout(() => r('slow'), 40)));

    const byDefault = await sender.request('receiver', 'a.v1', { n: 1 });
    const overridden = await sender.request('receiver', 'a.v1', { n: 1 }, { timeout: 200 });

    expect(byDefault.reason).toBe(RoutingReason.TIMEOUT);
    expect(overridden).toEqual(expect.objectContaining({ status: 'ACK', data: 'slow' }));
    core.destroy();
  });

  test('without a timeout the request waits (unchanged behaviour)', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', () => new Promise((r) => setTimeout(() => r('eventually'), 30)));

    const result = await sender.request('receiver', 'a.v1', { n: 1 });

    expect(result).toEqual(expect.objectContaining({ status: 'ACK', data: 'eventually' }));
    core.destroy();
  });
});

describe('noLocal', () => {
  test('by default a client does not receive its own emit', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const a = new BrokerClient('a', core);
    const b = new BrokerClient('b', core);
    const seenByA = jest.fn();
    const seenByB = jest.fn();
    a.on('a.v1', seenByA);
    b.on('a.v1', seenByB);

    const result = await a.emit('a.v1', { n: 1 });

    expect(seenByA).not.toHaveBeenCalled();
    expect(seenByB).toHaveBeenCalledTimes(1);
    expect(result.recipientIds).toEqual(['b']);
    core.destroy();
  });

  test('noLocal: false delivers the client its own emit and counts it as a recipient', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const a = new BrokerClient('a', core);
    const seenByA = jest.fn();
    a.on('a.v1', seenByA, { noLocal: false });

    const result = await a.emit('a.v1', { n: 1 });

    expect(seenByA).toHaveBeenCalledTimes(1);
    expect(seenByA.mock.calls[0]![0].source).toBe('a');
    expect(result.status).toBe('ACK');
    expect(result.recipientIds).toEqual(['a']);
    core.destroy();
  });

  test('per-subscription: only the noLocal:false handler of the sender fires, the default one stays excluded', async () => {
    const core = new BrokerCore<Topics, Payloads>({ logger: recordingLogger() });
    const a = new BrokerClient('a', core);
    const excluded = jest.fn();
    const included = jest.fn();
    a.on('a.v1', excluded);
    a.on('a.v1', included, { noLocal: false });

    await a.emit('a.v1', { n: 1 });

    expect(excluded).not.toHaveBeenCalled();
    expect(included).toHaveBeenCalledTimes(1);
    core.destroy();
  });
});

describe('backpressure strategies isolate async rejections', () => {
  test.each(['throttle', 'debounce', 'rateLimit'] as const)(
    '%s: a rejecting async handler is logged as backpressure.handler.failed with message meta',
    async (strategy) => {
      jest.useFakeTimers();
      const logger = recordingLogger();
      const core = new BrokerCore<Topics, Payloads>({ logger });
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const backpressure =
        strategy === 'throttle'
          ? { throttle: 10 }
          : strategy === 'debounce'
            ? { debounce: 10 }
            : { rateLimit: { max: 5, window: 1000 } };
      receiver.on('a.v1', async () => {
        throw new Error(`boom-${strategy}`);
      }, { backpressure });

      await sender.emit('a.v1', { n: 1 });
      jest.advanceTimersByTime(20);
      jest.useRealTimers();
      await tick();

      const failed = logger.calls.find(([, e]) => e === 'backpressure.handler.failed');
      expect(failed?.[2]).toEqual(
        expect.objectContaining({
          strategy,
          topic: 'a.v1',
          source: 'sender',
          messageId: expect.any(String),
          error: expect.objectContaining({ message: `boom-${strategy}` }),
        }),
      );
      core.destroy();
    },
  );
});

describe('log meta', () => {
  test('handler.failed carries messageId, topic, source and clientId', async () => {
    const logger = recordingLogger();
    const core = new BrokerCore<Topics, Payloads>({ logger });
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);
    receiver.on('a.v1', () => {
      throw new Error('nope');
    });

    await sender.request('receiver', 'a.v1', { n: 1 });
    await sender.emit('a.v1', { n: 2 });
    await tick();

    const entries = logger.calls.filter(([, e]) => e === 'handler.failed').map(([, , meta]) => meta);
    expect(entries).toHaveLength(2);
    for (const meta of entries) {
      expect(meta).toEqual(
        expect.objectContaining({
          clientId: 'receiver',
          topic: 'a.v1',
          source: 'sender',
          messageId: expect.any(String),
        }),
      );
    }
    core.destroy();
  });
});
