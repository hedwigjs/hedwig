import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';
import { RoutingReason } from './routing/RoutingResult';
import {
  initBroker,
  createClient,
  getBroker,
  destroyBroker,
} from '../facade';

type TestEventType = 'user.created.v1' | 'order.placed.v1' | 'notification.sent.v1';
type TestEventPayloads = {
  'user.created.v1': { userId: string; email: string };
  'order.placed.v1': { orderId: string; amount: number };
  'notification.sent.v1': { message: string };
};

/** Local helper replacing the old `core.getSubscriptions()[clientId]` pattern. */
function topicsOf(core: BrokerCore<any, any>, clientId: string): string[] {
  const client = core.inspect.getClients().find((c) => c.id === clientId);
  return client ? client.subscriptions.map((s) => s.topic) : [];
}

describe('BrokerCore v2', () => {
  let core: BrokerCore<TestEventType, TestEventPayloads>;

  beforeEach(() => {
    core = new BrokerCore<TestEventType, TestEventPayloads>();
  });

  afterEach(() => {
    core.destroy();
  });

  // ========================================
  // 1. CLOUDEVENTS FORMAT
  // ========================================

  describe('CloudEvents v1.0 Format', () => {
    test('should create events in CloudEvents v1.0 format', async () => {
      const sender = new BrokerClient('user-service', core);
      const receiver = new BrokerClient('notification-service', core);

      let receivedEvent: any;

      receiver.on('user.created.v1', (event) => {
        receivedEvent = event;
      });

      await sender.request('notification-service', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      const event = receivedEvent;

      // Check required event fields
      expect(event.id).toBeDefined();
      expect(event.topic).toBe('user.created.v1');
      expect(event.source).toBe('user-service');
      expect(event.target).toBe('notification-service');
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe('number');

      // Check data
      expect(event.data).toEqual({ userId: '123', email: 'test@example.com' });
    });

    test('should have immutable events (deepFreeze)', async () => {
      const client1 = new BrokerClient('client1', core);
      const client2 = new BrokerClient('client2', core);

      let receivedEvent: any;

      client2.on('user.created.v1', (event) => {
        receivedEvent = event;
        // Try to modify - should throw or be ignored
        expect(() => {
          (event.data as any).userId = 'modified';
        }).toThrow();
      });

      await client1.request('client2', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });
    });
  });

  // ========================================
  // 2. SUBSCRIPTION MANAGEMENT
  // ========================================

  describe('Subscription Management', () => {
    test('should subscribe client to event type', () => {
      const client = new BrokerClient('test-client', core);
      const handler = jest.fn();

      client.on('user.created.v1', handler);

      expect(core.inspect.getSubscribedClientIds()).toContain('test-client');
      expect(topicsOf(core, 'test-client')).toContain('user.created.v1');
    });

    test('should unsubscribe client from event type', () => {
      const client = new BrokerClient('test-client', core);
      const handler = jest.fn();

      client.on('user.created.v1', handler);
      expect(core.inspect.getSubscribedClientIds()).toContain('test-client');

      client.off('user.created.v1');
      expect(topicsOf(core, 'test-client')).toEqual([]);
    });

    test('should support multiple subscriptions from same client', () => {
      const client = new BrokerClient('test-client', core);

      client.on('user.created.v1', jest.fn());
      client.on('order.placed.v1', jest.fn());

      const subscriptions = topicsOf(core, 'test-client');
      expect(subscriptions).toContain('user.created.v1');
      expect(subscriptions).toContain('order.placed.v1');
      expect(subscriptions).toHaveLength(2);
    });

    test('should unsubscribe via returned function', () => {
      const client = new BrokerClient('test-client', core);
      const handler = jest.fn();

      const unsubscribe = client.on('user.created.v1', handler);
      expect(core.inspect.getSubscribedClientIds()).toContain('test-client');

      unsubscribe();
      expect(topicsOf(core, 'test-client')).toEqual([]);
    });
  });

  // ========================================
  // 3. UNICAST (Request)
  // ========================================

  describe('Unicast (Request)', () => {
    test('should send message to specific client', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);
      const other = new BrokerClient('other', core);

      let receiverCalled = false;
      let otherCalled = false;

      receiver.on('user.created.v1', () => {
        receiverCalled = true;
      });

      other.on('user.created.v1', () => {
        otherCalled = true;
      });

      await sender.request('receiver', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(receiverCalled).toBe(true);
      expect(otherCalled).toBe(false);
    });

    test('should return ACK for successful delivery', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      receiver.on('user.created.v1', jest.fn());

      const result = await sender.request('receiver', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(result.status).toBe('ACK');
      expect(result.reason).toBe(RoutingReason.DELIVERED);
      expect(result.recipientId).toBe('receiver');
    });

    test('should return NACK when recipient not subscribed', async () => {
      const sender = new BrokerClient('sender', core);
      new BrokerClient('receiver', core);

      const result = await sender.request('receiver', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(result.status).toBe('NACK');
      expect(result.reason).toBe(RoutingReason.NOT_SUBSCRIBED);
    });

    test('should return NACK when handler throws error', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      receiver.on('user.created.v1', () => {
        throw new Error('Handler error');
      });

      const result = await sender.request('receiver', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(result.status).toBe('NACK');
      expect(result.reason).toBe(RoutingReason.HANDLER_FAILED);
    });

    test('should support Request-Reply pattern', async () => {
      const client1 = new BrokerClient('client1', core);
      const client2 = new BrokerClient('client2', core);

      // client2 returns data from handler
      client2.on('user.created.v1', (event: any) => {
        return { created: true, userId: event.data.userId };
      });

      const result = await client1.request('client2', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(result.status).toBe('ACK');
      expect(result.data).toEqual({ created: true, userId: '123' });
    });
  });

  // ========================================
  // 4. MULTICAST (Emit)
  // ========================================

  describe('Multicast (Emit)', () => {
    test('should send message to all subscribers except sender', async () => {
      const sender = new BrokerClient('sender', core);
      const client1 = new BrokerClient('client1', core);
      const client2 = new BrokerClient('client2', core);

      const calls: string[] = [];

      client1.on('order.placed.v1', () => calls.push('client1'));
      client2.on('order.placed.v1', () => calls.push('client2'));
      sender.on('order.placed.v1', () => calls.push('sender'));

      await sender.emit('order.placed.v1', {
        orderId: 'order-123',
        amount: 100,
      });

      expect(calls).toContain('client1');
      expect(calls).toContain('client2');
      expect(calls).not.toContain('sender'); // Sender doesn't receive own event
    });

    test('should return ACK when subscribers exist', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      receiver.on('order.placed.v1', jest.fn());

      const result = await sender.emit('order.placed.v1', {
        orderId: 'order-123',
        amount: 100,
      });

      expect(result.status).toBe('ACK');
      expect(result.reason).toBe(RoutingReason.DISPATCHED);
    });

    test('should return NACK when no subscribers', async () => {
      const sender = new BrokerClient('sender', core);

      const result = await sender.emit('order.placed.v1', {
        orderId: 'order-123',
        amount: 100,
      });

      expect(result.status).toBe('NACK');
      expect(result.reason).toBe(RoutingReason.NO_SUBSCRIBERS);
    });

    test('should continue multicast despite handler errors', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const sender = new BrokerClient('sender', core);
      const errorClient = new BrokerClient('error-client', core);
      const successClient = new BrokerClient('success-client', core);

      errorClient.on('order.placed.v1', () => {
        throw new Error('Handler error');
      });

      let successCalled = false;
      successClient.on('order.placed.v1', () => {
        successCalled = true;
      });

      const result = await sender.emit('order.placed.v1', {
        orderId: 'order-123',
        amount: 100,
      });

      expect(result.status).toBe('ACK'); // Multicast is fire-and-forget
      expect(successCalled).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  // ========================================
  // 5. HOOKS
  // ========================================

  describe('Hooks', () => {
    describe('beforeSend Hook', () => {
      test('should execute beforeSend hook and allow event', async () => {
        const hookFn = jest.fn().mockReturnValue({ allowed: true });
        core.useBeforeSendHook(hookFn);

        const sender = new BrokerClient('sender', core);
        const receiver = new BrokerClient('receiver', core);

        receiver.on('user.created.v1', jest.fn());

        await sender.request('receiver', 'user.created.v1', {
          userId: '123',
          email: 'test@example.com',
        });

        expect(hookFn).toHaveBeenCalled();
        const event = hookFn.mock.calls[0][0];
        expect(event.topic).toBe('user.created.v1');
      });

      test('should block event when beforeSend returns not allowed', async () => {
        core.useBeforeSendHook(() => ({
          allowed: false,
          message: 'Access denied',
        }));

        const sender = new BrokerClient('sender', core);
        const receiver = new BrokerClient('receiver', core);

        const handler = jest.fn();
        receiver.on('user.created.v1', handler);

        const result = await sender.request('receiver', 'user.created.v1', {
          userId: '123',
          email: 'test@example.com',
        });

        expect(result.status).toBe('NACK');
        expect(result.reason).toBe(RoutingReason.HOOK_REJECTED);
        expect(result.message).toBe('Access denied');
        expect(handler).not.toHaveBeenCalled();
      });

      test('should pass immutable event to beforeSend hook', async () => {
        let hookEvent: any;

        core.useBeforeSendHook((event) => {
          hookEvent = event;
          // Try to modify
          expect(() => {
            (event.data as any).userId = 'hacked';
          }).toThrow();
          return { allowed: true };
        });

        const sender = new BrokerClient('sender', core);
        const receiver = new BrokerClient('receiver', core);

        receiver.on('user.created.v1', jest.fn());

        await sender.request('receiver', 'user.created.v1', {
          userId: '123',
          email: 'test@example.com',
        });

        expect(hookEvent).toBeDefined();
      });
    });

    describe('afterSend Hook', () => {
      test('should execute afterSend hook after event delivery', async () => {
        const hookFn = jest.fn();
        core.useAfterSendHook(hookFn);

        const sender = new BrokerClient('sender', core);
        const receiver = new BrokerClient('receiver', core);

        receiver.on('user.created.v1', jest.fn());

        await sender.request('receiver', 'user.created.v1', {
          userId: '123',
          email: 'test@example.com',
        });

        expect(hookFn).toHaveBeenCalled();
        const [event, result] = hookFn.mock.calls[0];
        expect(event.topic).toBe('user.created.v1');
        expect(result.status).toBe('ACK');
      });

      test('should receive NACK result in afterSend when blocked', async () => {
        const hookFn = jest.fn();

        core.useBeforeSendHook(() => ({ allowed: false, message: 'Blocked' }));
        core.useAfterSendHook(hookFn);

        const sender = new BrokerClient('sender', core);
        const receiver = new BrokerClient('receiver', core);

        receiver.on('user.created.v1', jest.fn());

        await sender.request('receiver', 'user.created.v1', {
          userId: '123',
          email: 'test@example.com',
        });

        expect(hookFn).toHaveBeenCalled();
        const [, result] = hookFn.mock.calls[0];
        expect(result.status).toBe('NACK');
        expect(result.reason).toBe(RoutingReason.HOOK_REJECTED);
        expect(result.message).toBe('Blocked');
      });
    });

    describe('onSubscribe Hook', () => {
      test('should execute onSubscribe hook when subscribing', () => {
        const hookFn = jest.fn().mockReturnValue({ allowed: true });
        core.useOnSubscribeHook(hookFn);

        const client = new BrokerClient('test-client', core);
        client.on('user.created.v1', jest.fn());

        expect(hookFn).toHaveBeenCalledWith('user.created.v1', 'test-client');
      });

      test('should block subscription when onSubscribe returns not allowed', () => {
        core.useOnSubscribeHook(() => ({
          allowed: false,
          message: 'Subscription denied',
        }));

        const client = new BrokerClient('test-client', core);

        expect(() => {
          client.on('user.created.v1', jest.fn());
        }).toThrow('Subscription denied');
      });
    });

    describe('Hook Cleanup', () => {
      test('should unsubscribe hook via returned function', async () => {
        const hookFn = jest.fn().mockReturnValue({ allowed: true });
        const unsubscribe = core.useBeforeSendHook(hookFn);

        const sender = new BrokerClient('sender', core);
        const receiver = new BrokerClient('receiver', core);

        receiver.on('user.created.v1', jest.fn());

        // Send event - hook should be called
        await sender.request('receiver', 'user.created.v1', {
          userId: '123',
          email: 'test@example.com',
        });
        expect(hookFn).toHaveBeenCalledTimes(1);

        // Unsubscribe hook
        unsubscribe();

        // Send again - hook should not be called
        await sender.request('receiver', 'user.created.v1', {
          userId: '456',
          email: 'test2@example.com',
        });
        expect(hookFn).toHaveBeenCalledTimes(1); // Still 1
      });
    });
  });

  // ========================================
  // 6. CLIENT REGISTRY
  // ========================================

  describe('Client Registry', () => {
    test('should register client automatically on construction', () => {
      new BrokerClient('client1', core);

      const clients = core.inspect.getClients();
      expect(clients).toHaveLength(1);
      expect(clients[0].id).toBe('client1');
    });

    test('should unregister client on destroy', () => {
      const client = new BrokerClient('client1', core);
      expect(core.inspect.getClients()).toHaveLength(1);

      client.destroy();
      expect(core.inspect.getClients()).toHaveLength(0);
    });

    test('should track subscribed clients', () => {
      const client1 = new BrokerClient('client1', core);
      const client2 = new BrokerClient('client2', core);

      client1.on('user.created.v1', jest.fn());
      // client2 не подписывается

      const subscribedClients = core.inspect.getSubscribedClientIds();
      expect(subscribedClients).toContain('client1');
      expect(subscribedClients).not.toContain('client2');
    });

    test('should get subscription details', () => {
      const client = new BrokerClient('client1', core);

      client.on('user.created.v1', jest.fn());
      client.on('order.placed.v1', jest.fn());

      expect(topicsOf(core, 'client1')).toEqual(['user.created.v1', 'order.placed.v1']);
    });
  });

  // ========================================
  // 7. LIFECYCLE
  // ========================================

  describe('Lifecycle', () => {
    test('should cleanup all resources on destroy', () => {
      const client1 = new BrokerClient('client1', core);
      const client2 = new BrokerClient('client2', core);

      client1.on('user.created.v1', jest.fn());
      client2.on('order.placed.v1', jest.fn());

      expect(core.inspect.getClients()).toHaveLength(2);
      expect(core.inspect.getSubscribedClientIds()).toHaveLength(2);

      core.destroy();

      expect(core.inspect.getClients()).toHaveLength(0);
      expect(core.inspect.getSubscribedClientIds()).toHaveLength(0);
    });

    test('should return NACK(BROKER_DESTROYED) on processMessage after destroy', async () => {
      const sender = new BrokerClient('sender', core);
      core.destroy();

      const result = await sender.emit('user.created.v1', {
        userId: '1',
        email: 'a@b.com',
      });

      expect(result.status).toBe('NACK');
      expect(result.reason).toBe(RoutingReason.BROKER_DESTROYED);
    });

    test('should ignore subscribe after destroy', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      core.destroy();

      core.subscribe('client1', 'user.created.v1', jest.fn());

      expect(warnSpy).toHaveBeenCalledWith(
        '[broker] broker.subscribe.after_destroy',
        { clientId: 'client1', topic: 'user.created.v1' },
      );
      warnSpy.mockRestore();
    });

    test('should ignore registerClient after destroy', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      core.destroy();

      const client = { id: 'late-client', on: jest.fn(), emit: jest.fn(), destroy: jest.fn() } as any;
      core.registerClient(client);

      expect(core.inspect.getClients()).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        '[broker] broker.client.register.after_destroy',
        { clientId: 'late-client' },
      );
      warnSpy.mockRestore();
    });

    test('should ignore addBridge after destroy', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      core.destroy();

      const transport = {
        send: jest.fn(),
        onMessage: jest.fn().mockReturnValue(jest.fn()),
        destroy: jest.fn(),
      };
      const removeBridge = core.addBridge('late-bridge', { transport, forward: ['user.*'] });

      expect(typeof removeBridge).toBe('function');
      expect(core.inspect.getBridges()).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        '[broker] broker.bridge.add.after_destroy',
        { bridgeId: 'late-bridge' },
      );
      warnSpy.mockRestore();
    });

    test('should be idempotent on double destroy', () => {
      const client = new BrokerClient('client1', core);
      client.on('user.created.v1', jest.fn());

      core.destroy();
      core.destroy();

      expect(core.inspect.getClients()).toHaveLength(0);
    });

    test('should have unique session IDs for different instances', async () => {
      const core1 = new BrokerCore();
      const core2 = new BrokerCore();

      const sender1 = new BrokerClient('sender1', core1);
      const receiver1 = new BrokerClient('receiver1', core1);

      const sender2 = new BrokerClient('sender2', core2);
      const receiver2 = new BrokerClient('receiver2', core2);

      let event1: any;
      let event2: any;

      receiver1.on('user.created.v1', (e) => {
        event1 = e;
      });

      receiver2.on('user.created.v1', (e) => {
        event2 = e;
      });

      await sender1.emit('user.created.v1', { userId: '1', email: 'test1@test.com' });
      await sender2.emit('user.created.v1', { userId: '2', email: 'test2@test.com' });

      // Different broker instances should have different session IDs in event IDs
      expect(event1.id).toBeDefined();
      expect(event2.id).toBeDefined();

      // Extract session part from ID (format: "sessionId-counter")
      const session1 = event1.id.split('-')[0];
      const session2 = event2.id.split('-')[0];
      expect(session1).not.toBe(session2);

      core1.destroy();
      core2.destroy();
    });
  });

  // ========================================
  // 8. EDGE CASES
  // ========================================

  describe('Edge Cases', () => {
    test('should handle rapid subscribe/unsubscribe', () => {
      const client = new BrokerClient('test-client', core);

      for (let i = 0; i < 100; i++) {
        const unsub = client.on('user.created.v1', jest.fn());
        unsub();
      }

      expect(topicsOf(core, 'test-client')).toEqual([]);
    });

    test('should handle empty data payload', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      let receivedData: any;
      receiver.on('notification.sent.v1', (event: any) => {
        receivedData = event.data;
      });

      await sender.request('receiver', 'notification.sent.v1', { message: '' });

      expect(receivedData).toEqual({ message: '' });
    });

    test('should handle async handlers', async () => {
      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      let handlerCompleted = false;

      receiver.on('user.created.v1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        handlerCompleted = true;
        return { success: true };
      });

      const result = await sender.request('receiver', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(result.status).toBe('ACK');
      expect(result.data).toEqual({ success: true });
      expect(handlerCompleted).toBe(true);
    });

    test('should handle multiple hooks of same type', async () => {
      const hook1 = jest.fn().mockReturnValue({ allowed: true });
      const hook2 = jest.fn().mockReturnValue({ allowed: true });
      const hook3 = jest.fn().mockReturnValue({ allowed: true });

      core.useBeforeSendHook(hook1);
      core.useBeforeSendHook(hook2);
      core.useBeforeSendHook(hook3);

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      receiver.on('user.created.v1', jest.fn());

      await sender.request('receiver', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
      expect(hook3).toHaveBeenCalled();
    });

    test('should stop processing if any beforeSend hook blocks', async () => {
      const hook1 = jest.fn().mockReturnValue({ allowed: true });
      const hook2 = jest.fn().mockReturnValue({ allowed: false, message: 'Blocked' });
      const hook3 = jest.fn().mockReturnValue({ allowed: true });

      core.useBeforeSendHook(hook1);
      core.useBeforeSendHook(hook2);
      core.useBeforeSendHook(hook3);

      const sender = new BrokerClient('sender', core);
      const receiver = new BrokerClient('receiver', core);

      const handler = jest.fn();
      receiver.on('user.created.v1', handler);

      const result = await sender.request('receiver', 'user.created.v1', {
        userId: '123',
        email: 'test@example.com',
      });

      expect(result.status).toBe('NACK');
      expect(result.reason).toBe(RoutingReason.HOOK_REJECTED);
      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
      expect(hook3).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Idempotent createClient', () => {
    let broker: ReturnType<typeof initBroker<TestEventType, TestEventPayloads>>;

    beforeEach(() => {
      broker = initBroker<TestEventType, TestEventPayloads>();
    });

    afterEach(() => {
      destroyBroker();
    });

    test('should return same instance when creating client with existing ID', () => {
      const client1 = createClient('cart');
      const client2 = createClient('cart');

      expect(client1).toBe(client2);
    });

    test('should log idempotent reset via pluggable logger', () => {
      const warn = jest.fn();
      destroyBroker();
      initBroker({ logger: { warn, error: jest.fn() } });

      createClient('cart');
      createClient('cart');

      expect(warn).toHaveBeenCalledWith('facade.createClient.reset', { clientId: 'cart' });
    });

    test('should clear old subscriptions on idempotent createClient', async () => {
      const sender = createClient('sender');
      const receiver = createClient('receiver');

      const oldHandler = jest.fn();
      receiver.on('user.created.v1', oldHandler);

      const receiverAgain = createClient('receiver');
      const newHandler = jest.fn();
      receiverAgain.on('user.created.v1', newHandler);

      await sender.emit('user.created.v1', { userId: '1', email: 'a@b.com' });

      expect(oldHandler).not.toHaveBeenCalled();
      expect(newHandler).toHaveBeenCalled();
    });

    test('should not duplicate clients in registry on idempotent createClient', () => {
      createClient('cart');
      createClient('cart');
      createClient('cart');

      expect(broker.inspect.getClients()).toHaveLength(1);
    });

    test('should keep other clients unaffected by idempotent createClient', async () => {
      const header = createClient('header');
      createClient('cart');

      const headerHandler = jest.fn();
      header.on('user.created.v1', headerHandler);

      createClient('cart');

      const sender = createClient('sender');
      await sender.emit('user.created.v1', { userId: '1', email: 'a@b.com' });

      expect(headerHandler).toHaveBeenCalled();
    });
  });

  describe('Idempotent addBridge', () => {
    let broker: ReturnType<typeof initBroker<TestEventType, TestEventPayloads>>;

    beforeEach(() => {
      broker = initBroker<TestEventType, TestEventPayloads>();
    });

    afterEach(() => {
      destroyBroker();
    });

    test('should destroy old bridge when adding bridge with same id', () => {
      const destroy1 = jest.fn();
      const destroy2 = jest.fn();

      const transport1 = {
        send: jest.fn(),
        onMessage: jest.fn().mockReturnValue(jest.fn()),
        destroy: destroy1,
      };
      const transport2 = {
        send: jest.fn(),
        onMessage: jest.fn().mockReturnValue(jest.fn()),
        destroy: destroy2,
      };

      broker.addBridge('cross-tab', { transport: transport1, forward: ['user.*'] });
      broker.addBridge('cross-tab', { transport: transport2, forward: ['user.*'] });

      expect(destroy1).toHaveBeenCalled();
      expect(destroy2).not.toHaveBeenCalled();
    });

    test('should not duplicate bridges with same id', async () => {
      const sendFn = jest.fn();

      const createTransport = () => ({
        send: sendFn,
        onMessage: jest.fn().mockReturnValue(jest.fn()),
        destroy: jest.fn(),
      });

      broker.addBridge('cross-tab', { transport: createTransport(), forward: ['user.*'] });
      broker.addBridge('cross-tab', { transport: createTransport(), forward: ['user.*'] });
      broker.addBridge('cross-tab', { transport: createTransport(), forward: ['user.*'] });

      const sender = createClient('sender');
      await sender.emit('user.created.v1', { userId: '1', email: 'a@b.com' });

      expect(sendFn).toHaveBeenCalledTimes(1);
    });

    test('should keep bridges with different ids independent', async () => {
      const send1 = jest.fn();
      const send2 = jest.fn();

      const transport1 = {
        send: send1,
        onMessage: jest.fn().mockReturnValue(jest.fn()),
        destroy: jest.fn(),
      };
      const transport2 = {
        send: send2,
        onMessage: jest.fn().mockReturnValue(jest.fn()),
        destroy: jest.fn(),
      };

      broker.addBridge('cross-tab', { transport: transport1, forward: ['user.*'] });
      broker.addBridge('iframe-checkout', { transport: transport2, forward: ['user.*'] });

      const sender = createClient('sender');
      await sender.emit('user.created.v1', { userId: '1', email: 'a@b.com' });

      expect(send1).toHaveBeenCalledTimes(1);
      expect(send2).toHaveBeenCalledTimes(1);
    });

    test('should remove bridge via returned cleanup function', async () => {
      const sendFn = jest.fn();
      const transport = {
        send: sendFn,
        onMessage: jest.fn().mockReturnValue(jest.fn()),
        destroy: jest.fn(),
      };

      const removeBridge = broker.addBridge('cross-tab', { transport, forward: ['user.*'] });
      removeBridge();

      const sender = createClient('sender');
      await sender.emit('user.created.v1', { userId: '1', email: 'a@b.com' });

      expect(sendFn).not.toHaveBeenCalled();
    });
  });
});

// ========================================
// FACADE API
// ========================================

describe('Facade API', () => {
  afterEach(() => {
    destroyBroker();
  });

  test('createClient throws if broker not initialized', () => {
    expect(() => createClient('cart')).toThrow('MessageBroker not initialized');
  });

  test('getBroker throws if broker not initialized', () => {
    expect(() => getBroker()).toThrow('MessageBroker not initialized');
  });

  test('createClient works after initBroker', () => {
    initBroker();
    const client = createClient('cart');
    expect(client).toBeDefined();
    expect(client.id).toBe('cart');
  });

  test('initBroker returns BrokerCore instance', () => {
    const broker = initBroker();
    expect(broker).toBeInstanceOf(BrokerCore);
  });

  test('getBroker returns the same instance as initBroker', () => {
    const broker = initBroker();
    expect(getBroker()).toBe(broker);
  });

  test('createClient is idempotent', () => {
    initBroker();
    const client1 = createClient('cart');
    const client2 = createClient('cart');
    expect(client1).toBe(client2);
  });

  test('destroyBroker clears the instance', () => {
    initBroker();
    destroyBroker();
    expect(() => createClient('cart')).toThrow('MessageBroker not initialized');
  });

  test('destroyBroker allows creating fresh broker', () => {
    const broker1 = initBroker();
    createClient('old-client');
    destroyBroker();

    const broker2 = initBroker();
    expect(broker2).not.toBe(broker1);
    expect(broker2.inspect.getClients()).toHaveLength(0);
  });

  test('initBroker is idempotent — returns same instance on duplicate call', () => {
    const broker1 = initBroker();
    const broker2 = initBroker();
    expect(broker1).toBe(broker2);
  });

  test('clients created via facade share the same broker', async () => {
    const broker = initBroker();
    const sender = createClient('sender');
    const receiver = createClient('receiver');

    const handler = jest.fn();
    receiver.on('user.created.v1', handler);

    await sender.emit('user.created.v1', { userId: '1', email: 'a@b.com' });

    expect(handler).toHaveBeenCalled();
    expect(broker.inspect.getClients()).toHaveLength(2);
  });
});
