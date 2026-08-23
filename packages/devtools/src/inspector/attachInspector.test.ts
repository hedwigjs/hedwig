import type { Message, RoutingResult } from "@hedwigjs/broker";
import { attachInspector } from "./attachInspector";
import { createInspectorStore } from "./createInspectorStore";
import { makeAck, makeTestMessage } from "./testFixtures";
import type { MessageBrokerForDevTools } from "./types";

/**
 * Tiny system events stub sufficient for the inspector wiring test.
 *
 * The inspector calls `on()` with specific event names and a void-returning
 * listener; we only need to return a no-op unsubscribe for each registration.
 */
function createSystemEventsStub() {
  return {
    on: jest.fn(() => () => {}),
    once: jest.fn(() => () => {}),
    off: jest.fn(),
    onAny: jest.fn(() => () => {}),
    listenerCount: jest.fn(() => 0),
  } as unknown as MessageBrokerForDevTools["$systemEvents"];
}

function createInspectStub() {
  return {
    getClients: jest.fn(() => []),
    getSubscribedClientIds: jest.fn(() => []),
    getBridges: jest.fn(() => []),
    getHistory: jest.fn(() => []),
    getHistoryStats: jest.fn(() => ({ count: 0, enabled: false })),
  } as unknown as MessageBrokerForDevTools["inspect"];
}

function createMockBroker() {
  let beforeHook: ((message: Readonly<Message>) => unknown) | undefined;
  let afterHook: ((message: Readonly<Message>, result: RoutingResult) => void) | undefined;

  const broker: MessageBrokerForDevTools = {
    useBeforeSendHook(
      fn: (message: Readonly<Message>) => { allowed: true } | { allowed: false; message: string },
    ) {
      beforeHook = fn;
      return () => {
        if (beforeHook === fn) beforeHook = undefined;
      };
    },
    useAfterSendHook(
      fn: (message: Readonly<Message>, result: RoutingResult) => void,
    ) {
      afterHook = fn;
      return () => {
        if (afterHook === fn) afterHook = undefined;
      };
    },
    $systemEvents: createSystemEventsStub(),
    inspect: createInspectStub(),
  };

  return {
    broker,
    fireBefore: (m: Readonly<Message>) => beforeHook?.(m) ?? { allowed: true },
    fireAfter: (m: Readonly<Message>, r: RoutingResult) => {
      afterHook?.(m, r);
    },
  };
}

describe("attachInspector", () => {
  it("registers hooks, marks attached, logs messages, and cleans up on detach", () => {
    const { broker, fireBefore, fireAfter } = createMockBroker();
    const store = createInspectorStore({ maxEvents: 20 });
    const detach = attachInspector(broker, store);

    expect(store.getSnapshot().attached).toBe(true);

    const m = makeTestMessage({ id: "x1" });
    fireBefore(m);
    expect(store.getSnapshot().entries).toHaveLength(1);
    expect(store.getSnapshot().entries[0]!.status).toBe("pending");

    fireAfter(m, makeAck());
    const e = store.getSnapshot().entries[0]!;
    expect(e.status).toBe("delivered");
    expect(e.result?.status).toBe("ACK");

    detach();
    expect(store.getSnapshot().attached).toBe(false);
  });

  it("subscribes to all client/subscription lifecycle system events", () => {
    const { broker } = createMockBroker();
    const store = createInspectorStore({ maxEvents: 20 });
    const on = broker.$systemEvents.on as jest.Mock;

    attachInspector(broker, store);

    const subscribedEvents = on.mock.calls.map(([event]) => event);
    expect(subscribedEvents).toEqual(
      expect.arrayContaining([
        "client.registered",
        "client.unregistered",
        "subscription.added",
        "subscription.removed",
      ]),
    );
  });
});
