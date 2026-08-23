import { createMessageRingBuffer } from "./ringLog";
import type { MessageLogEntry } from "./types";

function entry(id: string, topic = "t"): MessageLogEntry {
  return {
    id,
    topic,
    source: "s",
    target: "t",
    createdAt: new Date(0).toISOString(),
    status: "pending",
    kind: "multicast",
  };
}

describe("createMessageRingBuffer", () => {
  it("treats non-positive capacity as 1", () => {
    const ring = createMessageRingBuffer(0);
    const a = entry("a");
    ring.push(a);
    expect(ring.toArray().map((e) => e.id)).toEqual(["a"]);
    ring.push(entry("b"));
    expect(ring.toArray().map((e) => e.id)).toEqual(["b"]);
  });

  it("returns [] when empty and preserves oldest→newest order before overflow", () => {
    const ring = createMessageRingBuffer(3);
    expect(ring.toArray()).toEqual([]);

    ring.push(entry("1"));
    ring.push(entry("2"));
    expect(ring.toArray().map((e) => e.id)).toEqual(["1", "2"]);

    ring.push(entry("3"));
    expect(ring.toArray().map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("on overflow, drops the oldest and keeps size at capacity", () => {
    const ring = createMessageRingBuffer(2);
    ring.push(entry("1"));
    ring.push(entry("2"));
    ring.push(entry("3"));
    expect(ring.toArray().map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("findIndexById returns -1 or physical index for in-window ids", () => {
    const ring = createMessageRingBuffer(2);
    ring.push(entry("a"));
    const idx = ring.findIndexById("a");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(ring.getAt(idx)!.id).toBe("a");

    ring.setAt(idx, { ...ring.getAt(idx)!, topic: "x" });
    expect(ring.getAt(idx)!.topic).toBe("x");
    expect(ring.findIndexById("missing")).toBe(-1);
  });

  it("keeps findIndexById and toArray consistent after several wraps", () => {
    const cap = 3;
    const ring = createMessageRingBuffer(cap);
    for (let i = 0; i < 10; i += 1) {
      ring.push(entry(`m${i}`));
    }
    const arr = ring.toArray();
    expect(arr).toHaveLength(cap);
    expect(arr.map((e) => e.id)).toEqual(["m7", "m8", "m9"]);
    for (const e of arr) {
      expect(ring.findIndexById(e.id)).toBeGreaterThanOrEqual(0);
    }
  });
});
