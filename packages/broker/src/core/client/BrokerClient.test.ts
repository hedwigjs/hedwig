import { BrokerCore } from '../BrokerCore';
import { BrokerClient } from './BrokerClient';

type TestEvents = 'test.event.v1' | 'user.created.v1' | 'user.get';
type TestPayloads = {
  'test.event.v1': { message: string };
  'user.created.v1': { userId: string; email: string };
  'user.get': { userId: string };
};

/** Local helper replacing the old `core.getSubscriptions()[clientId]` pattern. */
function topicsOf(core: BrokerCore<any, any>, clientId: string): string[] {
  const client = core.inspect.getClients().find((c) => c.id === clientId);
  return client ? client.subscriptions.map((s) => s.topic) : [];
}

describe('BrokerClient', () => {
  let core: BrokerCore<TestEvents, TestPayloads>;

  beforeEach(() => {
    core = new BrokerCore();
  });

  afterEach(() => {
    core.destroy();
  });

  test('should create client and register in broker', () => {
    const client = new BrokerClient('test-client', core);

    expect(core.inspect.getClients()).toHaveLength(1);
    expect(core.inspect.getClients()[0].id).toBe('test-client');
  });

  test('should subscribe to events via on() with handler', () => {
    const client = new BrokerClient('test-client', core);
    const handler = jest.fn();

    const unsubscribe = client.on('test.event.v1', handler);

    expect(core.inspect.getSubscribedClientIds()).toContain('test-client');
    expect(typeof unsubscribe).toBe('function');
  });

  test('should throw error when subscribing without handler', () => {
    const client = new BrokerClient('test-client', core);

    expect(() => {
      // @ts-expect-error - testing error case
      client.on('test.event.v1');
    }).toThrow('BrokerClient requires explicit handler function');
  });

  test('should receive events via handler', async () => {
    const client1 = new BrokerClient('sender', core);
    const client2 = new BrokerClient('receiver', core);

    let receivedEvent: any = null;
    client2.on('test.event.v1', (event: any) => {
      receivedEvent = event;
    });

    await client1.request('receiver', 'test.event.v1', { message: 'Hello' });

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent.topic).toBe('test.event.v1');
    expect(receivedEvent.data).toEqual({ message: 'Hello' });
    expect(receivedEvent.source).toBe('sender');
  });

  test('should send unicast events via request()', async () => {
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);

    const handler = jest.fn();
    receiver.on('test.event.v1', handler);

    const result = await sender.request('receiver', 'test.event.v1', { message: 'Unicast' });

    expect(result.status).toBe('ACK');
    expect(handler).toHaveBeenCalled();
  });

  test('should send multicast events via emit()', async () => {
    const sender = new BrokerClient('sender', core);
    const receiver1 = new BrokerClient('receiver1', core);
    const receiver2 = new BrokerClient('receiver2', core);

    const handler1 = jest.fn();
    const handler2 = jest.fn();

    receiver1.on('test.event.v1', handler1);
    receiver2.on('test.event.v1', handler2);

    const result = await sender.emit('test.event.v1', { message: 'Broadcast' });

    expect(result.status).toBe('ACK');
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  test('should return NACK when sending to nonexistent client', async () => {
    const sender = new BrokerClient('sender', core);

    const result = await sender.request('nonexistent', 'test.event.v1', { message: 'Test' });

    expect(result.status).toBe('NACK');
    expect(result.message).toContain('not subscribed');
  });

  test('should unsubscribe correctly via off()', () => {
    const client = new BrokerClient('test-client', core);
    const handler = jest.fn();

    client.on('test.event.v1', handler);
    expect(core.inspect.getSubscribedClientIds()).toContain('test-client');

    client.off('test.event.v1');
    expect(topicsOf(core, 'test-client')).toEqual([]);
  });

  test('should unsubscribe correctly via unsubscribe function', () => {
    const client = new BrokerClient('test-client', core);
    const handler = jest.fn();

    const unsubscribe = client.on('test.event.v1', handler);
    expect(core.inspect.getSubscribedClientIds()).toContain('test-client');

    unsubscribe();
    expect(topicsOf(core, 'test-client')).toEqual([]);
  });

  test('should cleanup resources on destroy()', () => {
    const client = new BrokerClient('test-client', core);
    const handler = jest.fn();

    client.on('test.event.v1', handler);
    expect(core.inspect.getClients()).toHaveLength(1);

    client.destroy();

    expect(core.inspect.getClients()).toHaveLength(0);
  });

  test('should support multiple subscriptions to different events', async () => {
    const sender = new BrokerClient('sender', core);
    const receiver = new BrokerClient('receiver', core);

    const handler1 = jest.fn();
    const handler2 = jest.fn();

    receiver.on('test.event.v1', handler1);
    receiver.on('user.created.v1', handler2);

    await sender.request('receiver', 'test.event.v1', { message: 'Test' });
    await sender.request('receiver', 'user.created.v1', { userId: '123', email: 'test@test.com' });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  test('should work correctly with multiple clients', async () => {
    const client1 = new BrokerClient('client1', core);
    const client2 = new BrokerClient('client2', core);
    const client3 = new BrokerClient('client3', core);

    const handler1 = jest.fn();
    const handler2 = jest.fn();
    const handler3 = jest.fn();

    client1.on('test.event.v1', handler1);
    client2.on('test.event.v1', handler2);
    client3.on('test.event.v1', handler3);

    await client1.emit('test.event.v1', { message: 'Multicast to all' });

    // client1 не должен получить своё же событие
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
    expect(handler3).toHaveBeenCalled();
  });

  test('should support Request-Reply pattern', async () => {
    const client1 = new BrokerClient('client1', core);
    const client2 = new BrokerClient('client2', core);

    // client2 подписывается и возвращает данные
    client2.on('user.get', (event: any) => {
      return { name: 'John', id: event.data.userId };
    });

    // client1 делает запрос
    const result = await client1.request('client2', 'user.get', { userId: '123' });

    expect(result.status).toBe('ACK');
    expect(result.data).toEqual({ name: 'John', id: '123' });
  });

  describe('reset()', () => {
    test('should clear all subscriptions but keep client registered', () => {
      const client = new BrokerClient('test-client', core);
      const handler = jest.fn();

      client.on('test.event.v1', handler);
      client.on('user.created.v1', jest.fn());

      expect(core.inspect.getSubscribedClientIds()).toContain('test-client');
      expect(topicsOf(core, 'test-client')).toHaveLength(2);

      client.reset();

      expect(core.inspect.getClients()).toHaveLength(1);
      expect(core.inspect.getClients()[0].id).toBe('test-client');
      expect(topicsOf(core, 'test-client')).toEqual([]);
    });

    test('should allow new subscriptions after reset', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const oldHandler = jest.fn();
      receiver.on('test.event.v1', oldHandler);

      receiver.reset();

      const newHandler = jest.fn();
      receiver.on('test.event.v1', newHandler);

      await sender.emit('test.event.v1', { message: 'after reset' });

      expect(oldHandler).not.toHaveBeenCalled();
      expect(newHandler).toHaveBeenCalled();
    });

    test('should not affect other clients', async () => {
      const client1 = new BrokerClient('client1', core);
      const client2 = new BrokerClient('client2', core);

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      client1.on('test.event.v1', handler1);
      client2.on('test.event.v1', handler2);

      client1.reset();

      const sender = new BrokerClient('sender', core);
      await sender.emit('test.event.v1', { message: 'test' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });
});
