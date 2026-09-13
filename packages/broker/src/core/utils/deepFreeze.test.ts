import { deepFreeze } from './deepFreeze';

describe('deepFreeze', () => {
  test('freezes the object and every nested plain object / array', () => {
    const obj = { a: { b: { c: 1 } }, list: [{ x: 1 }, { y: 2 }] };

    deepFreeze(obj);

    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
    expect(Object.isFrozen(obj.list)).toBe(true);
    expect(Object.isFrozen(obj.list[0])).toBe(true);
  });

  test('returns the same reference (freezes in place, no copy)', () => {
    const obj = { n: 1 };
    expect(deepFreeze(obj)).toBe(obj);
  });

  test('survives cycles', () => {
    const a: any = { name: 'a' };
    const b: any = { name: 'b', a };
    a.b = b;

    expect(() => deepFreeze(a)).not.toThrow();
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
  });

  test('does not throw on a typed array with elements and leaves it mutable', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const obj = { bytes, meta: { len: 3 } };

    expect(() => deepFreeze(obj)).not.toThrow();

    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.meta)).toBe(true);
    expect(Object.isFrozen(bytes)).toBe(false);
    bytes[0] = 42;
    expect(bytes[0]).toBe(42);
  });

  test('skips ArrayBuffer, DataView and Float64Array as well', () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    const floats = new Float64Array([1.5, 2.5]);
    const obj = { buffer, view, floats };

    expect(() => deepFreeze(obj)).not.toThrow();
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(buffer)).toBe(false);
    expect(Object.isFrozen(view)).toBe(false);
    expect(Object.isFrozen(floats)).toBe(false);
  });

  test('a typed array passed at the top level is returned untouched', () => {
    const bytes = new Uint8Array([9]);
    expect(deepFreeze(bytes)).toBe(bytes);
    expect(Object.isFrozen(bytes)).toBe(false);
  });

  test('freezes siblings of binary data even when the binary value comes first', () => {
    const obj = { bytes: new Uint8Array([1]), later: { deep: true } };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.later)).toBe(true);
  });
});
