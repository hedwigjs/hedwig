/**
 * Glob-style topic matcher. Mirrors the broker-internal `matchPattern`
 * so DevTools can attribute messages to bridge forward-patterns without
 * a private import.
 *
 * Supported patterns:
 * - `*`             → matches everything
 * - `user.*`        → prefix
 * - `*.created.v1`  → suffix
 * - `user.*.v1`     → middle
 * - `user.login`    → exact
 */
export function matchPattern(topic: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (topic === pattern) return true;
  if (!pattern.includes("*")) return false;

  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${regexPattern}$`).test(topic);
}

export function matchesAnyPattern(topic: string, patterns: ReadonlyArray<string>): boolean {
  for (const p of patterns) {
    if (matchPattern(topic, p)) return true;
  }
  return false;
}
