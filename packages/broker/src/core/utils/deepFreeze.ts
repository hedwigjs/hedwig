/**
 * Deep freeze an object and all its nested properties
 *
 * Used to make events immutable before passing to hooks and handlers.
 * This prevents accidental mutations that could cause bugs.
 *
 * @param obj - Object to freeze
 * @returns Frozen object (same reference)
 */
export function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);

  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as any)[prop];
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  });

  return obj;
}
