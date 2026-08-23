import React from "react";
import type { MessageInspectorStore } from "../../inspector/createInspectorStore";
import type {
  MessageBrokerForDevTools,
  MessagesFilter,
  MessagesRollupConfig,
} from "../../inspector/types";
import type { DevToolsTabId } from "../shell/layout/panelTypes";
import { MessagesLogTab } from "./messages/MessagesLogTab";
import { ClientsLogTab } from "./clients/ClientsLogTab";
import { BridgesTab } from "./bridges/BridgesTab";
import { ReplayBufferTab } from "./replay-buffer/ReplayBufferTab";
import { SystemEventsTab } from "./system-events/SystemEventsTab";
import { DebugTab } from "./debug/DebugTab";

export interface TabNavigateOptions {
  filterPatch?: Partial<MessagesFilter>;
}

export interface TabRenderContext {
  /** Navigate to another tab, optionally pre-setting a Messages filter. */
  onNavigate: (tab: DevToolsTabId, options?: TabNavigateOptions) => void;
  /** Rollup config for the Messages tab; `null` disables grouping. */
  messagesRollup: MessagesRollupConfig | null;
  /** Broker reference — needed by the Debug tab to call $debug.send. */
  broker: MessageBrokerForDevTools;
}

/**
 * Extension point: add a new section by adding to `DevToolsTabId` union + a case here.
 */
export function renderActiveTab(
  id: DevToolsTabId,
  store: MessageInspectorStore,
  context: TabRenderContext,
): React.ReactNode {
  switch (id) {
    case "messages":
      return <MessagesLogTab store={store} rollup={context.messagesRollup} />;
    case "clients":
      return <ClientsLogTab store={store} onNavigate={context.onNavigate} />;
    case "bridges":
      return <BridgesTab store={store} />;
    case "replay-buffer":
      return <ReplayBufferTab store={store} />;
    case "system-events":
      return <SystemEventsTab store={store} />;
    case "debug":
      return <DebugTab store={store} broker={context.broker} />;
    default:
      return <MessagesLogTab store={store} rollup={context.messagesRollup} />;
  }
}
