import type { InspectorSnapshot } from "../../inspector/types";
import type { DevToolsTabId } from "../shell/layout/panelTypes";

export interface TabDefinition {
  id: DevToolsTabId;
  label: string;
  /** Returns the badge count to show next to the tab label. Always shown when defined. */
  getBadge?: (snapshot: InspectorSnapshot) => number;
}

export const MBDT_TAB_DEFINITIONS: ReadonlyArray<TabDefinition> = [
  {
    id: "messages",
    label: "Messages",
    getBadge: (snapshot) => snapshot.totalSeen,
  },
  {
    id: "clients",
    label: "Clients",
    getBadge: (snapshot) => snapshot.clients.length,
  },
  {
    id: "bridges",
    label: "Bridges",
    getBadge: (snapshot) => snapshot.bridges.length,
  },
  {
    id: "replay-buffer",
    label: "Replay Buffer",
    getBadge: (snapshot) => snapshot.historyEntries.length,
  },
  {
    id: "system-events",
    label: "System Events",
    getBadge: (snapshot) => snapshot.systemEvents.length,
  },
] as const;
