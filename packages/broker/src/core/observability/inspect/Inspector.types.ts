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
