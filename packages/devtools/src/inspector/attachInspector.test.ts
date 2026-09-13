import { VERSION } from "@hedwigjs/broker";
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
}

function createInspectStub(options: InspectStubOptions = {}) {
  return {
    getClients: jest.fn(() => []),
    getSubscribedClientIds: jest.fn(() => []),
    getHistory: jest.fn(() => []),
    getHistoryStats: jest.fn(() => ({ count: 0, topics: [], enabled: true })),
    getVersionInfo: jest.fn(() => ({
      version: VERSION,
      duplicateCopies: options.duplicateCopies ?? 0,
    })),
  } as unknown as MessageBrokerForDevTools["inspect"];
}

interface MockBrokerOptions extends InspectStubOptions {
  version?: string | undefined;
}

function createMockBroker(options: MockBrokerOptions = {}) {
  let beforeHook: ((message: Readonly<Message>) => unknown) | undefined;
  let afterHook: ((message: Readonly<Message>, result: RoutingResult) => void) | undefined;

  const broker: MessageBrokerForDevTools = {
    version: "version" in options ? options.version : VERSION,
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
      enabled: true,
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
        "remote.created",
        "remote.destroyed",
        "remote.frame.rejected",
        "remote.send.failed",
        "request.forwarded",
        "response.received",
        "request.timeout",
        "response.sent",
        "state.retained",
        "broker.duplicate_copy",
        "hook.failed",
      ]),
    );
  });

  it("logs remote.frame.rejected into the System Events ring without refreshing clients", () => {
    const { broker } = createMockBroker();
    const store = createInspectorStore({ maxEvents: 20 });
    const on = broker.$systemEvents.on as jest.Mock;
    const getClients = broker.inspect.getClients as jest.Mock;

    attachInspector(broker, store);
    const callsBefore = getClients.mock.calls.length;

    const listener = on.mock.calls.find(([event]) => event === "remote.frame.rejected")?.[1];
    expect(listener).toBeDefined();
    listener({ remoteId: "backend", reason: "SOURCE_MISMATCH", source: "cart", topic: "a.v1" });

    expect(store.getSnapshot().systemEvents.at(-1)).toEqual(
      expect.objectContaining({
        name: "remote.frame.rejected",
        payload: expect.objectContaining({ remoteId: "backend", reason: "SOURCE_MISMATCH" }),
      }),
    );
    expect(getClients.mock.calls.length).toBe(callsBefore);
  });

  it("records remote clients from the inspect snapshot with their remote block", () => {
    const { broker } = createMockBroker();
    (broker.inspect.getClients as jest.Mock).mockReturnValue([
      { id: "cart", connectedAt: 1, subscriptions: [{ topic: "a.v1", handlerCount: 1 }] },
      {
        id: "backend",
        connectedAt: 2,
        subscriptions: [{ topic: "cart.*", handlerCount: 0 }],
        remote: {
          kind: "websocket",
          identity: "fixed",
          duplex: true,
          fanout: false,
          requests: true,
          accepts: ["notification.*"],
          pending: 0,
        },
      },
    ]);
    const store = createInspectorStore({ maxEvents: 20 });

    attachInspector(broker, store);

    const clients = store.getSnapshot().clients;
    expect(clients.find((c) => c.id === "cart")?.remote).toBeUndefined();
    expect(clients.find((c) => c.id === "backend")?.remote).toEqual({
      kind: "websocket",
      identity: "fixed",
      duplex: true,
      fanout: false,
      requests: true,
      accepts: ["notification.*"],
      pending: 0,
    });
    expect(clients.find((c) => c.id === "backend")?.subscriptions.map((s) => s.topic)).toEqual(["cart.*"]);
  });

  it("counts a remote client's activity by `via` and by forwarded multicasts", () => {
    const { broker, fireBefore, fireAfter } = createMockBroker();
    (broker.inspect.getClients as jest.Mock).mockReturnValue([
      {
        id: "tabs",
        connectedAt: 2,
        subscriptions: [{ topic: "cart.*", handlerCount: 0 }],
        remote: {
          kind: "broadcast-channel",
          identity: "prefix",
          duplex: true,
          fanout: true,
          requests: false,
          accepts: ["cart.*"],
          pending: 0,
        },
      },
    ]);
    const store = createInspectorStore({ maxEvents: 20 });
    attachInspector(broker, store);

    // Injected by the other tab: source is the prefixed peer, via is the remote.
    const inbound = makeTestMessage({ id: "in", topic: "cart.snapshot.v1", source: "tab:cart-store", target: "*", fromExternal: true, via: "tabs" });
    fireBefore(inbound);
    fireAfter(inbound, makeAck());
    // Local multicast on a forwarded topic: sent to the remote.
    const outbound = makeTestMessage({ id: "out", topic: "cart.snapshot.v1", source: "cart-store", target: "*" });
    fireBefore(outbound);
    fireAfter(outbound, makeAck());
    // Unrelated local traffic.
    const other = makeTestMessage({ id: "other", topic: "menu.opened.v1", source: "menu", target: "*" });
    fireBefore(other);
    fireAfter(other, makeAck());

    const tabs = store.getSnapshot().clients.find((c) => c.id === "tabs")!;
    expect(tabs.sentCount).toBe(1);
    expect(tabs.receivedCount).toBe(1);
    expect(tabs.lastActiveAt).not.toBeNull();
    expect(tabs.subscriptions[0]!.lastReceivedAt).not.toBeNull();
  });

  it("keeps `via` on a message delivered by a remote client", () => {
    const { broker, fireBefore, fireAfter } = createMockBroker();
    const store = createInspectorStore({ maxEvents: 20 });
    attachInspector(broker, store);

    const m = makeTestMessage({
      id: "r1",
      fromExternal: true,
      via: "backend",
      wireId: "wire-7",
      ext: { traceparent: "00-abc", hedwig: { claimedSource: "backend" } },
    });
    fireBefore(m);
    fireAfter(m, makeAck());

    expect(store.getSnapshot().entries[0]).toEqual(
      expect.objectContaining({
        id: "r1",
        fromExternal: true,
        via: "backend",
        wireId: "wire-7",
        ext: { traceparent: "00-abc", hedwig: { claimedSource: "backend" } },
      }),
    );
  });

  describe("version handshake", () => {
    it("records a compatible core version without flagging a mismatch", () => {
      const { broker } = createMockBroker();
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      expect(store.getSnapshot().version).toEqual({
        expected: VERSION,
        actual: VERSION,
        mismatch: false,
      });
    });

    it("flags a mismatch when the core is an incompatible @hedwigjs/broker version", () => {
      const { broker } = createMockBroker({ version: "99.0.0" });
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      expect(store.getSnapshot().version).toEqual({
        expected: VERSION,
        actual: "99.0.0",
        mismatch: true,
      });
    });

    it("does not flag a core that predates the version field", () => {
      const { broker } = createMockBroker({ version: undefined });
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      expect(store.getSnapshot().version.mismatch).toBe(false);
      expect(store.getSnapshot().version.actual).toBeUndefined();
    });

    it("hydrates broker.duplicate_copy from the inspect snapshot", () => {
      const { broker } = createMockBroker({ duplicateCopies: 2 });
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      const dup = store.getSnapshot().systemEvents.find((e) => e.name === "broker.duplicate_copy");
      expect(dup?.payload).toEqual(
        expect.objectContaining({ version: VERSION, copies: 2, hydrated: true }),
      );
    });

    it("hydrates nothing when the core is the only copy", () => {
      const { broker } = createMockBroker();
      const store = createInspectorStore({ maxEvents: 20 });

      attachInspector(broker, store);

      const names = store.getSnapshot().systemEvents.map((e) => e.name);
      expect(names).not.toContain("broker.duplicate_copy");
    });
  });
});
