import { useMemo, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import type {
  MessageBrokerForDevTools,
  MessagesRollupConfig,
} from "../../../inspector/types";
import { MBDT_TAB_DEFINITIONS } from "../../tabs/definitions";
import { renderActiveTab } from "../../tabs/renderActiveTab";
import type { TabRenderContext } from "../../tabs/renderActiveTab";
import type {
  DevToolsLayoutState,
  DevToolsPanelPosition,
  DevToolsTabId,
} from "../layout/panelTypes";
import { PanelResizeHandle } from "./PanelResizeHandle";
import styles from "./DevToolsShell.module.css";

const DOCK: Record<DevToolsPanelPosition, string> = {
  top: styles.dockTop,
  bottom: styles.dockBottom,
  left: styles.dockLeft,
  right: styles.dockRight,
};

const POS_LABEL: Record<DevToolsPanelPosition, string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

const POS_GLYPH: Record<DevToolsPanelPosition, string> = {
  top: "↑",
  bottom: "↓",
  left: "←",
  right: "→",
};

const ALL_POSITIONS: DevToolsPanelPosition[] = [
  "top",
  "bottom",
  "left",
  "right",
];

function shellInlineStyle(layout: DevToolsLayoutState): CSSProperties {
  if (layout.isFullscreen) {
    return {};
  }
  const m = layout.sizeMain;
  switch (layout.position) {
    case "bottom":
      return { left: 0, right: 0, bottom: 0, height: m, maxHeight: "95vh" };
    case "top":
      return { left: 0, right: 0, top: 0, height: m, maxHeight: "95vh" };
    case "left":
      return { left: 0, top: 0, bottom: 0, width: m, maxWidth: "100vw" };
    case "right":
      return { right: 0, top: 0, bottom: 0, width: m, maxWidth: "100vw" };
    default:
      return {};
  }
}

export interface DevToolsShellProps {
  store: MessageInspectorStore;
  layout: DevToolsLayoutState;
  messagesRollup: MessagesRollupConfig | null;
  broker: MessageBrokerForDevTools;
  onClose: () => void;
  onPositionChange: (p: DevToolsPanelPosition) => void;
  onTabChange: (t: DevToolsTabId) => void;
  onSetSizeMain: (px: number) => void;
  onToggleFullscreen: () => void;
}

export const DevToolsShell = ({
  store,
  layout,
  messagesRollup,
  broker,
  onClose,
  onPositionChange,
  onTabChange,
  onSetSizeMain,
  onToggleFullscreen,
}: DevToolsShellProps): ReactNode => {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const { attached } = snapshot;

  const boxStyle = useMemo(
    () => shellInlineStyle(layout),
    [layout.isFullscreen, layout.position, layout.sizeMain],
  );

  const shellClass = useMemo(() => {
    if (layout.isFullscreen) {
      return `${styles.shell} ${styles.shellFullscreen}`;
    }
    return `${styles.shell} ${DOCK[layout.position]}`;
  }, [layout.isFullscreen, layout.position]);

  const tabContext: TabRenderContext = useMemo(
    () => ({
      onNavigate: (tab, options) => {
        if (options?.filterPatch) store.setMessagesFilter(options.filterPatch);
        onTabChange(tab);
      },
      messagesRollup,
      broker,
    }),
    [store, onTabChange, messagesRollup, broker],
  );

  return (
    <div
      className={shellClass}
      style={boxStyle}
      data-mbdt-panel="1"
      data-mbdt-position={layout.position}
      data-mbdt-fullscreen={layout.isFullscreen ? "1" : "0"}
    >
      <PanelResizeHandle
        position={layout.position}
        onResize={onSetSizeMain}
        disabled={layout.isFullscreen}
      />
      <div className={styles.header} data-mbdt-header>
        <span className={styles.title}>@hedwigjs/devtools</span>
        <span
          className={`${styles.badge} ${
            attached ? styles.badgeOn : styles.badgeOff
          }`}
        >
          {attached ? "connected" : "disconnected"}
        </span>
        <span className={styles.spacer} />
        <div className={styles.positionGroup} title="Panel dock side">
          {ALL_POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={layout.isFullscreen}
              className={`${styles.positionBtn} ${
                layout.position === p ? styles.positionBtnActive : ""
              }`}
              title={POS_LABEL[p]}
              aria-label={`Dock to ${p}`}
              aria-pressed={layout.position === p}
              onClick={() => onPositionChange(p)}
            >
              {POS_GLYPH[p]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.headerBtn} ${
            layout.isFullscreen ? styles.headerBtnActive : ""
          }`}
          onClick={onToggleFullscreen}
          title={layout.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={
            layout.isFullscreen ? "Exit fullscreen" : "Fullscreen"
          }
          aria-pressed={layout.isFullscreen}
        >
          {layout.isFullscreen ? "⤓" : "⤢"}
        </button>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          title="Close"
          aria-label="Close devtools"
        >
          ×
        </button>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Devtools sections">
        {MBDT_TAB_DEFINITIONS.map((tab) => {
          const badge = tab.getBadge?.(snapshot) ?? 0;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={`${styles.tab} ${
                layout.activeTab === tab.id ? styles.tabActive : ""
              }`}
              aria-selected={layout.activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
              {tab.getBadge !== undefined && (
                <span className={styles.tabBadge}>{badge > 999 ? "999+" : badge}</span>
              )}
            </button>
          );
        })}
      </div>
      <div
        className={styles.body}
        role="tabpanel"
        data-mbdt-active-tab={layout.activeTab}
      >
        {renderActiveTab(layout.activeTab, store, tabContext)}
      </div>
    </div>
  );
};
