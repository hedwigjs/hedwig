/**
 * Package version, injected at build time by tsup (`define`), so the
 * runtime can compare itself with other copies of the library and tooling
 * can compare itself with the runtime. Falls back to a dev marker under
 * ts-jest, where no define step runs.
 */
declare const __HEDWIG_VERSION__: string | undefined;

export const VERSION: string =
  typeof __HEDWIG_VERSION__ === 'string' ? __HEDWIG_VERSION__ : '0.0.0-dev';

/**
 * Registry key on `globalThis`. `Symbol.for` resolves to the same symbol
 * from every copy of this module within one realm — two bundled copies find
 * each other through the global symbol registry, not through module identity.
 *
 * Scope is ONE realm (one window / worker). An iframe or a Worker has its
 * own `globalThis`, its own broker and talks through a transport.
 */
export const GLOBAL_REGISTRY_KEY: unique symbol = Symbol.for('@hedwigjs/broker') as never;

/**
 * Semver compatibility rule used when a second copy of the library meets
 * an instance created by another copy:
 *
 * - before 1.0 a minor bump is breaking, so `0.x.*` copies must share the
 *   same minor;
 * - from 1.0 on, copies must share the major.
 *
 * Patch and pre-release suffixes never matter. Two dev builds
 * (`0.0.0-dev`) are compatible.
 */
export function isCompatibleVersion(a: string, b: string): boolean {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a === b;
  if (pa.major !== pb.major) return false;
  if (pa.major === 0) return pa.minor === pb.minor;
  return true;
}

function parse(v: string): { major: number; minor: number } | null {
  const m = /^(\d+)\.(\d+)\./.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}
