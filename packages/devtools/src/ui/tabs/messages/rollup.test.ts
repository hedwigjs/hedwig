import type { MessageLogEntry } from "../../../inspector/types";
import { computeDisplayItems } from "./rollup";

/**
 * Test fixture: minimal MessageLogEntry with sensible defaults so each
 * test can override only the fields it cares about (topic, source, time).
 */
function e(
  overrides: Partial<MessageLogEntry> & { id: string; topic: string; source: string; at: number },
): MessageLogEntry {
  const { at, ...rest } = overrides;
  return {
    target: "*",
    status: "delivered",
    kind: "multicast",
    ...rest,
    createdAt: new Date(at).toISOString(),
  };
}

describe("computeDisplayItems", () => {
  test("empty input → empty output", () => {
    expect(computeDisplayItems([], { minCount: 5, windowMs: 1000 })).toEqual([]);
  });

  test("null rollup → every entry becomes a single (flat log)", () => {
    const entries = [
      e({ id: "1", topic: "a.v1", source: "s", at: 0 }),
      e({ id: "2", topic: "a.v1", source: "s", at: 10 }),
      e({ id: "3", topic: "a.v1", source: "s", at: 20 }),
    ];
    const items = computeDisplayItems(entries, null);
    expect(items.map((i) => i.kind)).toEqual(["single", "single", "single"]);
  });

  test("burst below minCount stays flattened", () => {
    const entries = [
      e({ id: "1", topic: "a.v1", source: "s", at: 0 }),
      e({ id: "2", topic: "a.v1", source: "s", at: 10 }),
      e({ id: "3", topic: "a.v1", source: "s", at: 20 }),
      e({ id: "4", topic: "a.v1", source: "s", at: 30 }),
    ];
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.kind === "single")).toBe(true);
  });

  test("burst at minCount folds into a stream", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      e({ id: String(i), topic: "chat.reply-chunk.v1", source: "ai-backend", at: i * 30 }),
    );
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });

    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("stream");
    if (items[0]!.kind !== "stream") return;
    expect(items[0]!.count).toBe(5);
    expect(items[0]!.topic).toBe("chat.reply-chunk.v1");
    expect(items[0]!.source).toBe("ai-backend");
    expect(items[0]!.firstAt).toBe(0);
    expect(items[0]!.lastAt).toBe(120);
  });

  test("stream breaks on topic change", () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: `a${i}`, topic: "a.v1", source: "s", at: i * 10 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: `b${i}`, topic: "b.v1", source: "s", at: 100 + i * 10 }),
      ),
    ];
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });

    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe("stream");
    expect(items[1]!.kind).toBe("stream");
    if (items[0]!.kind === "stream") expect(items[0]!.topic).toBe("a.v1");
    if (items[1]!.kind === "stream") expect(items[1]!.topic).toBe("b.v1");
  });

  test("stream breaks on source change", () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: `a${i}`, topic: "notif.v1", source: "src-a", at: i * 10 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: `b${i}`, topic: "notif.v1", source: "src-b", at: 100 + i * 10 }),
      ),
    ];
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });

    expect(items).toHaveLength(2);
    if (items[0]!.kind === "stream" && items[1]!.kind === "stream") {
      expect(items[0]!.source).toBe("src-a");
      expect(items[1]!.source).toBe("src-b");
    }
  });

  test("stream breaks when the gap exceeds windowMs", () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: `a${i}`, topic: "t.v1", source: "s", at: i * 10 }),
      ),
      // Gap of 5s — way beyond the 1s window; must break.
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: `b${i}`, topic: "t.v1", source: "s", at: 5000 + i * 10 }),
      ),
    ];
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === "stream")).toBe(true);
  });

  test("mixed traffic: single entries around a stream", () => {
    const entries = [
      e({ id: "x", topic: "unrelated.v1", source: "u", at: 0 }),
      ...Array.from({ length: 8 }, (_, i) =>
        e({ id: `s${i}`, topic: "chat.reply-chunk.v1", source: "ai-backend", at: 100 + i * 30 }),
      ),
      e({ id: "y", topic: "unrelated.v1", source: "u", at: 500 }),
    ];
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });

    expect(items.map((i) => i.kind)).toEqual(["single", "stream", "single"]);
    if (items[1]!.kind === "stream") {
      expect(items[1]!.count).toBe(8);
    }
  });

  test("stream key is stable across identical inputs (memo-friendly)", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      e({ id: `x${i}`, topic: "t.v1", source: "s", at: i * 10 }),
    );

    const a = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });
    const b = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });

    if (a[0]!.kind === "stream" && b[0]!.kind === "stream") {
      expect(a[0]!.key).toBe(b[0]!.key);
    }
  });

  test("preserves chronological order inside a stream", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      e({ id: `x${i}`, topic: "t.v1", source: "s", at: i * 10 }),
    );
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });
    if (items[0]!.kind === "stream") {
      expect(items[0]!.entries.map((x) => x.id)).toEqual([
        "x0",
        "x1",
        "x2",
        "x3",
        "x4",
        "x5",
      ]);
    }
  });

  test("adjacent stream + non-stream burst emit as separate items", () => {
    const entries = [
      // 6-entry stream
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: `s${i}`, topic: "chat.reply-chunk.v1", source: "ai-backend", at: i * 30 }),
      ),
      // 3-entry cluster of a different topic — below minCount, stays flat
      ...Array.from({ length: 3 }, (_, i) =>
        e({ id: `n${i}`, topic: "notif.v1", source: "backend", at: 200 + i * 40 }),
      ),
    ];
    const items = computeDisplayItems(entries, { minCount: 5, windowMs: 1000 });

    expect(items.map((i) => i.kind)).toEqual([
      "stream",
      "single",
      "single",
      "single",
    ]);
  });
});
