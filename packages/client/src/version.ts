declare const __HEDWIG_SDK_VERSION__: string | undefined;

/** Version of this SDK build; reported to the runtime in `ClientMeta`. */
export const SDK_VERSION: string =
  typeof __HEDWIG_SDK_VERSION__ === 'string' ? __HEDWIG_SDK_VERSION__ : '0.0.0-dev';

/**
 * The oldest runtime whose behaviour matches this SDK's types. Bumped in
 * lockstep with runtime releases that add to the ABI-1 surface; a newer
 * SDK never calls into an older runtime that silently lacks what the
 * types promise (`RUNTIME_TOO_OLD`).
 */
export const MIN_RUNTIME = '0.1.1';

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
