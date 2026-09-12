import { PROTOCOL_VERSION } from "@hedwigjs/broker";
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

interface InspectStubOptions {
  duplicateCopies?: number;
  otherProtocolVersions?: number[];
}

function createInspectStub(options: InspectStubOptions = {}) {
  return {
    getClients: jest.fn(() => []),
    getSubscribedClientIds: jest.fn(() => []),
    getBridges: jest.fn(() => []),
    getHistory: jest.fn(() => []),
    getHistoryStats: jest.fn(() => ({ count: 0, enabled: false })),
    getProtocolInfo: jest.fn(() => ({
      protocolVersion: PROTOCOL_VERSION,
      duplicateCopies: options.duplicateCopies ?? 0,
      otherProtocolVersions: options.otherProtocolVersions ?? [],
    })),
  } as unknown as MessageBrokerForDevTools["inspect"];
}

interface MockBrokerOptions extends InspectStubOptions {
  protocolVersion?: number | undefined;
}

function createMockBroker(options: MockBrokerOptions = {}) {
  let beforeHook: ((message: Readonly<Message>) => unknown) | undefined;
  let afterHook: ((message: Readonly<Message>, result: RoutingResult) => void) | undefined;

  const broker: MessageBrokerForDevTools = {
    protocolVersion: "protocolVersion" in options ? options.protocolVersion : PROTOCOL_VERSION,
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
    inspect: createInspectStub(options),
    $debug: {
      send: jest.fn(async () => ({
        status: "ACK",
        reason: "DISPATCHED",
        message: "",
      })) as unknown as MessageBrokerForDevTools["$debug"]["send"],
    },
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

  it("subscribes to every lifecycle, security, failure and realm-singleton system event", () => {
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
        "subscription.rejected",
        "message.rejected",
        "bridge.added",
        "bridge.removed",
        "bridge.send.failed",
        "broker.duplicate_copy",
        "broker.protocol_mismatch",
      ]),
    );
  });

  it("logs bridge.send.failed into the System Events ring without touching the bridge list", () => {
    const { broker } = createMockBroker();
    const store = createInspectorStore({ maxEvents: 20 });
    const on = broker.$systemEvents.on as jest.Mock;
    const refreshBridges = broker.inspect.getBridges as jest.Mock;

    attachInspector(broker, store);
    const callsBefore = refreshBridges.mock.calls.length;

    const listener = on.mock.calls.find(([event]) => event === "bridge.send.failed")?.[1];
    expect(listener).toBeDefined();
    listener({ bridgeId: "ws", topic: "a.v1", messageId: "m-1", error: new Error("wire down") });

    const { systemEvents } = store.getSnapshot();
    expect(systemEvents.at(-1)).toEqual(
      expect.objectContaining({
        name: "bridge.send.failed",
        payload: expect.objectContaining({ bridgeId: "ws", topic: "a.v1", messageId: "m-1" }),
      }),
    );
    expect(refreshBridges.mock.calls.length).toBe(callsBefore);
  });

  describe("protocol handshake", () => {
    it("records a matching protocol version without flagging a mismatch", () => {
      const { broker } = createMockBroker();
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      expect(store.getSnapshot().protocol).toEqual({
        expected: PROTOCOL_VERSION,
        actual: PROTOCOL_VERSION,
        mismatch: false,
      });
    });

    it("flags a mismatch when the core speaks a different PROTOCOL_VERSION", () => {
      const { broker } = createMockBroker({ protocolVersion: PROTOCOL_VERSION + 1 });
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      expect(store.getSnapshot().protocol).toEqual({
        expected: PROTOCOL_VERSION,
        actual: PROTOCOL_VERSION + 1,
        mismatch: true,
      });
    });

    it("does not flag a core that predates the protocolVersion field", () => {
      const { broker } = createMockBroker({ protocolVersion: undefined });
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      expect(store.getSnapshot().protocol.mismatch).toBe(false);
      expect(store.getSnapshot().protocol.actual).toBeUndefined();
    });

    it("hydrates broker.duplicate_copy and broker.protocol_mismatch from the inspect snapshot", () => {
      const { broker } = createMockBroker({ duplicateCopies: 2, otherProtocolVersions: [7] });
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      const names = store.getSnapshot().systemEvents.map((e) => e.name);
      expect(names).toEqual(
        expect.arrayContaining(["broker.duplicate_copy", "broker.protocol_mismatch"]),
      );
      const dup = store.getSnapshot().systemEvents.find((e) => e.name === "broker.duplicate_copy");
      expect(dup?.payload).toEqual(
        expect.objectContaining({ copies: 2, hydrated: true }),
      );
      const mismatch = store
        .getSnapshot()
        .systemEvents.find((e) => e.name === "broker.protocol_mismatch");
      expect(mismatch?.payload).toEqual(
        expect.objectContaining({ otherVersions: [7], hydrated: true }),
      );
    });

    it("hydrates nothing when the core is the only copy", () => {
      const { broker } = createMockBroker();
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      const names = store.getSnapshot().systemEvents.map((e) => e.name);
      expect(names).not.toContain("broker.duplicate_copy");
      expect(names).not.toContain("broker.protocol_mismatch");
    });
  });
});
