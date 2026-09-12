/**
 * Realm-singleton diagnostics, produced by `broker.inspect.getProtocolInfo()`.
 *
 * `duplicateCopies` and `otherProtocolVersions` are usually populated during
 * app bootstrap, before any observer has attached — tooling reads this
 * snapshot on attach instead of relying on having seen the live
 * `broker.duplicate_copy` / `broker.protocol_mismatch` events.
 */
export interface ProtocolInfo {
  /** Protocol version of this core (`PROTOCOL_VERSION` it was built with). */
  protocolVersion: number;
  /** How many other copies of the library adopted this instance so far. */
  duplicateCopies: number;
  /** Protocol versions of OTHER brokers that coexist in this realm. */
  otherProtocolVersions: number[];
}

/**
 * Read-only view of a registered bridge.
 *
 * Produced by `broker.inspect.getBridges()`. Does NOT leak the internal
 * `Bridge` instance (`transport`, lifecycle methods, etc.) — only the
 * information useful for DevTools / debugging.
 */
export interface BridgeInfo {
  /** Unique bridge identifier passed to `addBridge(id, ...)`. */
  id: string;
  /** Topic patterns this bridge forwards to its transport. */
  forwardPatterns: ReadonlyArray<string>;
  /**
   * Transport class name with the `Transport` suffix stripped —
   * e.g. `WebSocket`, `PostMessage`, `SSE`, `BroadcastChannel`, or the
   * bare constructor name for custom implementations. `undefined` when
   * the transport was created from an anonymous class expression.
   */
  transportKind?: string;
}
