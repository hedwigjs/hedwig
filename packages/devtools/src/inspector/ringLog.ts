import type { MessageLogEntry } from "./types";

/**
 * Кольцо на фиксированной ёмкости: O(1) на append при полном буфере, без копирования хвоста.
 * Порядок `toArray()` — от старейшей записи к новейшей.
 *
 * Generic — используется и для сообщений, и для системных событий.
 * Опциональный `keyOf` позволяет искать элемент по внутреннему id
 * (нужно для двухфазной записи сообщения: pending → delivered).
 */
export function createRingBuffer<T>(capacity: number, keyOf?: (item: T) => string) {
  const cap = Math.max(1, capacity);
  const buf: T[] = new Array(cap);
  let head = 0;
  let size = 0;

  function toArray(): T[] {
    if (size === 0) {
      return [];
    }
    const out: T[] = new Array(size);
    for (let i = 0; i < size; i++) {
      out[i] = buf[(head + i) % cap]!;
    }
    return out;
  }

  /** Индекс в buf или -1. Работает только если `keyOf` был задан. */
  function findIndexById(id: string): number {
    if (!keyOf) return -1;
    for (let i = 0; i < size; i++) {
      const idx = (head + i) % cap;
      if (keyOf(buf[idx]!) === id) {
        return idx;
      }
    }
    return -1;
  }

  function push(e: T): void {
    if (size < cap) {
      const idx = (head + size) % cap;
      buf[idx] = e;
      size += 1;
    } else {
      buf[head] = e;
      head = (head + 1) % cap;
    }
  }

  function setAt(physicalIndex: number, e: T): void {
    buf[physicalIndex] = e;
  }

  /** Слот, найденный `findIndexById` — валидная запись. */
  function getAt(physicalIndex: number): T | undefined {
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

/**
 * Convenience factory для главного кольца сообщений — сохраняет старую
 * сигнатуру, чтобы не переписывать call-sites одним махом.
 */
export function createMessageRingBuffer(capacity: number) {
  return createRingBuffer<MessageLogEntry>(capacity, (e) => e.id);
}
