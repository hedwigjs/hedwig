import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';

/**
 * Subscriptions take exact topic names. Live delivery is keyed by name, so
 * a pattern in `on()` would have matched history on replay and then
 * received nothing live — it is refused up front instead.
 */
describe('on() takes exact topic names', () => {
  test('a wildcard pattern throws a TypeError and registers nothing', async () => {
    const core = new BrokerCore<'chat.a.v1' | 'chat.*', { 'chat.a.v1': number; 'chat.*': number }>({
      topics: { 'chat.a.v1': { kind: 'event', retention: { last: 5 } } },
    });
    await new BrokerClient('pub', core).emit('chat.a.v1', 1);
    const sub = new BrokerClient('sub', core);
    const handler = jest.fn();

    expect(() => sub.on('chat.*', handler, { replay: { limit: 5 } })).toThrow(TypeError);
    expect(handler).not.toHaveBeenCalled();
    expect(core.inspect.getClients().find((c) => c.id === 'sub')?.subscriptions).toHaveLength(0);

    // The exact name works, replay included.
    sub.on('chat.a.v1', handler, { replay: { limit: 5 } });
    expect(handler).toHaveBeenCalledTimes(1);
    core.destroy();
  });

  test('patterns stay where they belong: accepts / forward on a remote client', () => {
    const core = new BrokerCore<'chat.a.v1', { 'chat.a.v1': number }>();
    expect(() =>
      core.createRemoteClient('peer', {
        transport: { send: jest.fn(), onMessage: () => () => {}, destroy: jest.fn() },
        accepts: ['chat.*'],
        forward: ['chat.*'],
      }),
    ).not.toThrow();
    core.destroy();
  });
});
