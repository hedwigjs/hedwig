declare const __HEDWIG_SDK_VERSION__: string | undefined;
declare const __HEDWIG_MIN_RUNTIME__: string | undefined;

/** Version of this SDK build; reported to the runtime in `ClientMeta`. */
export const SDK_VERSION: string =
  typeof __HEDWIG_SDK_VERSION__ === 'string' ? __HEDWIG_SDK_VERSION__ : '0.0.0-dev';

/**
 * The oldest runtime whose behaviour matches this SDK's types; an older
 * one is refused with `RUNTIME_TOO_OLD` rather than silently lacking what
 * the types promise. Before 1.0 the SDK and the runtime are released
 * together and each release has extended the ABI-1 surface, so this is
 * the runtime version from the same release — baked at build time from
 * `@hedwigjs/broker`'s package.json. When the two stop moving in lockstep,
 * pin a literal here instead.
 */
export const MIN_RUNTIME: string =
  typeof __HEDWIG_MIN_RUNTIME__ === 'string' ? __HEDWIG_MIN_RUNTIME__ : '0.0.0-dev';

/** Numeric semver compare on `major.minor.patch`; pre-release tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[-+]/)[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
