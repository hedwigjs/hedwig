/**
 * Realm-singleton diagnostics, produced by `broker.inspect.getVersionInfo()`.
 *
 * `duplicateCopies` is usually populated during app bootstrap, before any
 * observer has attached — tooling reads this snapshot on attach instead of
 * relying on having seen the live `broker.duplicate_copy` events.
 */
export interface VersionInfo {
  /** Package version of the copy that created this core. */
  version: string;
  /** How many other (compatible) copies of the library adopted this instance. */
  duplicateCopies: number;
}
