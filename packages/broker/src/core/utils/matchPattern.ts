/**
 * Pattern matching utility for topics
 *
 * Supports patterns:
 * - '*' — matches everything
 * - 'user.*' — prefix: matches 'user.login', 'user.logout.confirmed'
 * - '*.created.v1' — suffix: matches 'user.created.v1', 'order.created.v1'
 * - 'user.*.v1' — middle: matches 'user.login.v1', 'user.logout.v1'
 * - 'user.login' — exact match
 */

/**
 * Check if topic matches a single pattern
 *
 * @param topic - Topic to check (e.g. 'user.login')
 * @param pattern - Pattern to match against (e.g. 'user.*')
 * @returns true if matches
 */
export function matchPattern(topic: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (topic === pattern) return true;
  if (!pattern.includes('*')) return false;

  // Convert glob pattern to regex: escape special chars, replace * with .*
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  return new RegExp(`^${regexPattern}$`).test(topic);
}

/**
 * Check if topic matches any of the patterns
 *
 * @param topic - Topic to check
 * @param patterns - Array of patterns
 * @returns true if matches at least one pattern
 */
export function matchesAnyPattern(topic: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(topic, pattern));
}
