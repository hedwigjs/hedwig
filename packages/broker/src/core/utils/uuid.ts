/**
 * RFC 4122 version-4 UUID that works outside secure contexts.
 *
 * Browsers expose `crypto.randomUUID()` only in secure contexts (`https:`
 * and `localhost`). Plain-`http://` staging and intranet hosts are common
 * in enterprise setups, and there `initBroker()` used to throw on its very
 * first line. Order of preference:
 *
 *  1. `crypto.randomUUID()` — native; secure contexts and Node.
 *  2. `crypto.getRandomValues()` — available in every modern browser
 *     regardless of context, and in Node.
 *  3. `Math.random()` — last resort for exotic runtimes without Web Crypto.
 *     Not cryptographically strong, and that is fine: the value is a
 *     session label used to build message ids, not a secret.
 */
export function generateUUID(): string {
  const webCrypto = (globalThis as { crypto?: Partial<Crypto> }).crypto;

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    try {
      return webCrypto.randomUUID();
    } catch {
      // Some runtimes define the method but refuse to run it outside a
      // secure context. Fall through to the manual path.
    }
  }

  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Version nibble (4) and RFC 4122 variant bits (10xx).
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += (bytes[i]! + 0x100).toString(16).slice(1);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
