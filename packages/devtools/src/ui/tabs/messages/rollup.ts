import type {
  MessageLogEntry,
  MessagesRollupConfig,
} from "../../../inspector/types";

/**
 * A contiguous run of messages that share `(topic, source)` and arrived
 * within `windowMs` gaps of each other. Rendered as a single collapsible
 * row so that stream-y topics (e.g. `chat.reply-chunk.v1`) don't flood the
 * log.
 */
export interface StreamGroup {
  kind: "stream";
  /** Stable React key derived from the first entry's id. */
  key: string;
  topic: string;
  source: string;
  /** Chronological (oldest → newest). */
  entries: MessageLogEntry[];
  count: number;
  /** Unix ms of the first entry in the group. */
  firstAt: number;
  /** Unix ms of the latest entry in the group. */
  lastAt: number;
}

export interface SingleGroup {
  kind: "single";
  entry: MessageLogEntry;
}

export type DisplayItem = StreamGroup | SingleGroup;

/**
 * Fold consecutive matching entries into stream groups.
 *
 * Input is expected in chronological order (oldest → newest). Output is in
 * the same order — reverse in the view layer for display.
 *
 * Boundary rules:
 * - Group breaks when topic OR source changes.
 * - Group breaks when the gap between adjacent entries exceeds `windowMs`.
 * - A run with fewer than `minCount` entries is emitted as individual
 *   `SingleGroup`s rather than a stream — the rollup is only worth the
 *   click if the burst is substantial.
 *
 * Pending entries (no `createdAt` change) group by their creation
 * timestamp; if a stream is still receiving frames, the last entry's time
 * keeps advancing and new arrivals extend the same group naturally.
 */
export function computeDisplayItems(
  entriesOldToNew: ReadonlyArray<MessageLogEntry>,
  rollup: MessagesRollupConfig | null,
): DisplayItem[] {
  if (!rollup || entriesOldToNew.length === 0) {
    return entriesOldToNew.map((entry) => ({ kind: "single", entry }));
  }

  const out: DisplayItem[] = [];
  let buffer: MessageLogEntry[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length >= rollup.minCount) {
      const first = buffer[0]!;
      const last = buffer[buffer.length - 1]!;
      out.push({
        kind: "stream",
        key: `stream-${first.id}`,
        topic: first.topic,
        source: first.source,
        entries: buffer,
        count: buffer.length,
        firstAt: new Date(first.createdAt).getTime(),
        lastAt: new Date(last.createdAt).getTime(),
      });
    } else {
      for (const entry of buffer) {
        out.push({ kind: "single", entry });
      }
    }
    buffer = [];
  };

  for (const entry of entriesOldToNew) {
    const prev = buffer[buffer.length - 1];
    if (!prev) {
      buffer.push(entry);
      continue;
    }
    const sameStream =
      entry.topic === prev.topic &&
      entry.source === prev.source &&
      new Date(entry.createdAt).getTime() -
        new Date(prev.createdAt).getTime() <=
        rollup.windowMs;
    if (sameStream) {
      buffer.push(entry);
    } else {
      flush();
      buffer.push(entry);
    }
  }
  flush();
  return out;
}
