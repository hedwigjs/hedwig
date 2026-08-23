import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageBrokerForDevTools } from "../inspector/types";
import { createInspectorStore } from "../inspector/createInspectorStore";
import { attachInspector } from "../inspector/attachInspector";
import { DevToolsShell } from "./shell/devtoolsShell/DevToolsShell";
import { FloatingToggleButton } from "./shell/floatingToggleButton/FloatingToggleButton";
import type { DevToolsPanelPosition } from "./shell/layout/panelTypes";
import { usePanelLayoutState } from "./shell/layout/usePanelLayoutState";
import { TopicsRegistryProvider } from "./topicsRegistry";
import type { TopicsRegistry } from "./topicsRegistry";

export type { DevToolsPanelPosition } from "./shell/layout/panelTypes";

export interface MessageBrokerDevToolsProps {
  broker: MessageBrokerForDevTools;
  /**
   * Каталог топиков из registry-пакета (например, `@your-org/topics-registry`).
   * Если передан — будущие табы (Topics, Send-tester) показывают полный
   * перечень контрактов и примеры payload'ов. Loose coupling: DevTools
   * не зависит от конкретного registry-пакета.
   */
  registry?: TopicsRegistry;
  /** Defaults to true only in development (requires DefinePlugin in the build). */
  enabled?: boolean;
  /** Maximum number of recent events to keep in the log. */
  maxEvents?: number;
  /** Default dock side for the panel (also the first value written to localStorage). */
  defaultPosition?: DevToolsPanelPosition;
  /** localStorage key for position, active tab, and open state. */
  storageKey?: string;
  /** Whether the panel is open by default (when no saved state exists). */
  defaultOpen?: boolean;
  /** Icon for the floating toggle button. Falls back to the built-in mascot PNG. */
  toggleIcon?: ReactNode;
}

export const MessageBrokerDevTools = ({
  broker,
  registry,
  enabled = process.env.NODE_ENV === "development",
  maxEvents = 100,
  defaultPosition = "bottom",
  storageKey,
  defaultOpen = false,
  toggleIcon,
}: MessageBrokerDevToolsProps): ReactNode => {
  const store = useMemo(() => createInspectorStore({ maxEvents }), [maxEvents]);

  const [
    layout,
    { setOpen, setPosition, setActiveTab, setSizeMain, toggleFullscreen },
  ] = usePanelLayoutState({
    storageKey,
    defaultPosition,
    defaultOpen,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return attachInspector(broker, store);
  }, [broker, enabled, store]);

  const { attached } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  if (!enabled) {
    return null;
  }

  return (
    <TopicsRegistryProvider registry={registry}>
      {!layout.isOpen && (
        <FloatingToggleButton
          position={layout.position}
          attached={attached}
          onOpen={() => setOpen(true)}
          icon={toggleIcon}
        />
      )}
      {layout.isOpen && (
        <DevToolsShell
          store={store}
          layout={layout}
          onClose={() => setOpen(false)}
          onPositionChange={setPosition}
          onTabChange={setActiveTab}
          onSetSizeMain={setSizeMain}
          onToggleFullscreen={toggleFullscreen}
        />
      )}
    </TopicsRegistryProvider>
  );
};
