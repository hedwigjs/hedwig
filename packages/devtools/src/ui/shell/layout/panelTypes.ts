/**
 * Dock side of the panel (similar to the toolbar in React Query Devtools).
 * top/bottom — full-width panel; left/right — side column.
 */
export type DevToolsPanelPosition = "top" | "bottom" | "left" | "right";

/**
 * Tab identifiers. Add new sections here and in `renderActiveTab.tsx`.
 */
export type DevToolsTabId =
  | "messages"
  | "clients"
  | "bridges"
  | "replay-buffer"
  | "system-events"
  | "debug";

export interface DevToolsPreFullscreen {
  sizeMain: number;
  position: DevToolsPanelPosition;
}

export interface DevToolsLayoutState {
  isOpen: boolean;
  position: DevToolsPanelPosition;
  activeTab: DevToolsTabId;
  /** Panel occupies the full viewport; exit restores preFullscreen. */
  isFullscreen: boolean;
  /**
   * Main-axis size in px: top/bottom panels use height, left/right use width.
   */
  sizeMain: number;
  /**
   * Captured on fullscreen enter; not persisted to localStorage (in-memory only while the panel is open).
   */
  preFullscreen: DevToolsPreFullscreen | null;
}
