/**
 * Transport contracts are owned by `@hedwigjs/client` (a module names a
 * built-in by descriptor or passes a custom `Transport`); re-exported here.
 */
import type { TransportDescriptor } from '@hedwigjs/client';

export type { Transport, TransportDescriptor, TransportFrameMeta, TransportKind } from '@hedwigjs/client';

export function isTransportDescriptor(value: unknown): value is TransportDescriptor {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { send?: unknown }).send !== 'function'
  );
}
