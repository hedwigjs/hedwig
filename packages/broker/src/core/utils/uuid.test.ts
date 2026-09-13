import { generateUUID } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Swap `globalThis.crypto` for the duration of a test. In Node the property
 * is an accessor on the global object, so a plain assignment would not
 * stick — redefine it and restore the original descriptor afterwards.
 */
function withCrypto<T>(replacement: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: replacement,
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'crypto', original);
    } else {
      delete (globalThis as { crypto?: unknown }).crypto;
    }
  }
}

describe('generateUUID', () => {
  test('produces an RFC 4122 v4 UUID with the native API', () => {
    const id = generateUUID();
    expect(id).toMatch(V4);
  });

  test('prefers crypto.randomUUID when it is available', () => {
    const randomUUID = jest.fn(() => '11111111-2222-4333-8444-555555555555');
    const getRandomValues = jest.fn();

    const id = withCrypto({ randomUUID, getRandomValues }, () => generateUUID());

    expect(id).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  test('falls back to getRandomValues when randomUUID is absent (insecure browser context)', () => {
    const getRandomValues = jest.fn((buf: Uint8Array) => {
      for (let i = 0; i < buf.length; i++) buf[i] = i * 17;
      return buf;
    });

    const id = withCrypto({ getRandomValues }, () => generateUUID());

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toMatch(V4);
  });

  test('falls back to getRandomValues when randomUUID exists but throws', () => {
    const randomUUID = jest.fn(() => {
      throw new TypeError('not allowed in this context');
    });
    const getRandomValues = jest.fn((buf: Uint8Array) => buf.fill(7));

    const id = withCrypto({ randomUUID, getRandomValues }, () => generateUUID());

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toMatch(V4);
  });

  test('falls back to Math.random when Web Crypto is missing entirely', () => {
    const id = withCrypto(undefined, () => generateUUID());
    expect(id).toMatch(V4);
  });

  test('sets version and variant bits on the manual path regardless of input bytes', () => {
    const allOnes = { getRandomValues: (buf: Uint8Array) => buf.fill(0xff) };
    const allZeros = { getRandomValues: (buf: Uint8Array) => buf.fill(0x00) };

    const a = withCrypto(allOnes, () => generateUUID());
    const b = withCrypto(allZeros, () => generateUUID());

    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(b).toBe('00000000-0000-4000-8000-000000000000');
  });

  test('ids are unique across many calls on every path', () => {
    const native = new Set(Array.from({ length: 500 }, () => generateUUID()));
    const manual = withCrypto(undefined, () => new Set(Array.from({ length: 500 }, () => generateUUID())));

    expect(native.size).toBe(500);
    expect(manual.size).toBe(500);
  });
});
