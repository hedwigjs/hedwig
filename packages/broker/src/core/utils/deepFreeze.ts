/**
 * Deep freeze an object and all its nested properties.
 *
 * Used to make messages immutable before passing to hooks and handlers, so
 * a subscriber cannot mutate what the next subscriber sees.
 *
 * Two things to know:
 *
 * - **It freezes in place.** The object the emitter passed as `data` is the
 *   object that gets frozen — there is no copy. Emitters that hand over a
 *   live store object will find it frozen afterwards. This is deliberate:
 *   copying every payload on the hot path would cost more than the
 *   guarantee is worth. Pass a snapshot if you need to keep mutating.
 *
 * - **Binary data is left alone.** `Object.freeze` throws on typed arrays
 *   that have elements ("Cannot freeze array buffer views with elements"),
 *   and freezing an `ArrayBuffer` gains nothing. `ArrayBuffer`,
 *   `SharedArrayBuffer` and every view over them (`Uint8Array`, `DataView`,
 *   …) are skipped and stay mutable. Everything around them is still frozen.
 *
 * Cycles are safe: an already-frozen object is not descended into again.
 *
 * @param obj - Object to freeze
 * @returns The same reference, frozen
 */
export function deepFreeze<T>(obj: T): T {
  if (isBinary(obj)) return obj;

  Object.freeze(obj);

  for (const prop of Object.getOwnPropertyNames(obj)) {
    const value = (obj as any)[prop];
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      !isBinary(value) &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  }

  return obj;
}

/**
 * `ArrayBuffer`, `SharedArrayBuffer`, or any view over one (typed arrays,
 * `DataView`). These cannot be meaningfully frozen and typed arrays with
 * elements throw on `Object.freeze`.
 */
function isBinary(value: unknown): boolean {
  if (ArrayBuffer.isView(value)) return true;
  if (value instanceof ArrayBuffer) return true;
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}
