/**
 * Formats a Unix timestamp (ms) as a human-readable relative time string.
 * Returns "never" for null, "just now" for < 1s, otherwise "Xs/Xm/Xh ago".
 */
export function formatRelativeTime(ts: number | null): string {
  if (ts === null) return "never";
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
