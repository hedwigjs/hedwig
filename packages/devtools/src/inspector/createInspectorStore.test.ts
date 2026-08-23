import { createInspectorStore } from "./createInspectorStore";
import { makeAck, makeNack, makeTestMessage } from "./testFixtures";

describe("createInspectorStore", () => {
  it("increments totalSeen and keeps entries in pending then delivered order", () => {
    const store = createInspectorStore({ maxEvents: 10 });
    const m = makeTestMessage({ id: "a1" });
    expect(store.getSnapshot().totalSeen).toBe(0);

    store.onBeforeSend(m);
    let snap = store.getSnapshot();
    expect(snap.totalSeen).toBe(1);
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]!.id).toBe("a1");
    expect(snap.entries[0]!.status).toBe("pending");

    store.onAfterSend(m, makeAck());
    snap = store.getSnapshot();
    expect(snap.totalSeen).toBe(1);
    expect(snap.entries[0]!.status).toBe("delivered");
    expect(snap.entries[0]!.result?.status).toBe("ACK");
  });

  it("setAttached is reflected in snapshot", () => {
    const store = createInspectorStore({ maxEvents: 5 });
    expect(store.getSnapshot().attached).toBe(false);
    store.setAttached(true);
    expect(store.getSnapshot().attached).toBe(true);
    store.setAttached(false);
    expect(store.getSnapshot().attached).toBe(false);
  });

  it("onAfterSend without prior onBefore appends and increases totalSeen", () => {
    const store = createInspectorStore({ maxEvents: 10 });
    const m = makeTestMessage({ id: "orphan" });
    store.onAfterSend(m, makeAck());
    const snap = store.getSnapshot();
    expect(snap.totalSeen).toBe(1);
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]!.status).toBe("delivered");
  });

  it("marks entry as failed on NACK", () => {
    const store = createInspectorStore({ maxEvents: 10 });
    const m = makeTestMessage({ id: "f1" });
    store.onBeforeSend(m);
    store.onAfterSend(m, makeNack());
    expect(store.getSnapshot().entries[0]!.status).toBe("failed");
  });

  it("ring: keeps at most maxEvents, oldest to newest, totalSeen is global count", () => {
    const maxEvents = 2;
    const store = createInspectorStore({ maxEvents });
    for (let i = 0; i < 5; i += 1) {
      const id = `m${i}`;
      const msg = makeTestMessage({ id, topic: `t${i}` });
      store.onBeforeSend(msg);
      store.onAfterSend(msg, makeAck());
    }
    const snap = store.getSnapshot();
    expect(snap.totalSeen).toBe(5);
    const ids = snap.entries.map((e) => e.id);
    expect(ids).toEqual(["m3", "m4"]);
    expect(snap.entries[0]!.status).toBe("delivered");
  });

  it("notifies subscribers on updates", () => {
    const store = createInspectorStore({ maxEvents: 5 });
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    const m = makeTestMessage();
    store.onBeforeSend(m);
    store.onAfterSend(m, makeAck());
    off();
    store.onBeforeSend(makeTestMessage({ id: "2" }));
    expect(calls).toBe(2);
  });
});
