import type { MessageLogEntry } from "./types";

/**
 * Кольцо на фиксированной ёмкости: O(1) на append при полном буфере, без копирования хвоста.
 * Порядок `toArray()` — от старейшей записи к новейшей.
 */
export function createMessageRingBuffer(capacity: number) {
  const cap = Math.max(1, capacity);
  const buf: MessageLogEntry[] = new Array(cap);
  let head = 0;
  let size = 0;

  function toArray(): MessageLogEntry[] {
    if (size === 0) {
      return [];
    }
    const out: MessageLogEntry[] = new Array(size);
    for (let i = 0; i < size; i++) {
      out[i] = buf[(head + i) % cap]!;
    }
    return out;
  }

  /** Индекс в buf или -1. */
  function findIndexById(id: string): number {
    for (let i = 0; i < size; i++) {
      const idx = (head + i) % cap;
      if (buf[idx]!.id === id) {
        return idx;
      }
    }
    return -1;
  }

  function push(e: MessageLogEntry): void {
    if (size < cap) {
      const idx = (head + size) % cap;
      buf[idx] = e;
      size += 1;
    } else {
      buf[head] = e;
      head = (head + 1) % cap;
    }
  }

  function setAt(physicalIndex: number, e: MessageLogEntry): void {
    buf[physicalIndex] = e;
  }

  /** Слот, найденный `findIndexById` — валидная запись. */
  function getAt(physicalIndex: number): MessageLogEntry | undefined {
    return buf[physicalIndex];
  }

  function clear(): void {
    head = 0;
    size = 0;
  }

  return {
    push,
    setAt,
    getAt,
    findIndexById,
    toArray,
    clear,
  };
}
