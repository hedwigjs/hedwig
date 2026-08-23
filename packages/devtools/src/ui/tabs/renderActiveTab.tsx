import React from "react";
import type { MessageInspectorStore } from "../../inspector/createInspectorStore";
import type { MessagesFilter } from "../../inspector/types";
import type { DevToolsTabId } from "../shell/layout/panelTypes";
import { MessagesLogTab } from "./messages/MessagesLogTab";
import { ClientsLogTab } from "./clients/ClientsLogTab";
import { ReplayBufferTab } from "./replay-buffer/ReplayBufferTab";

export interface TabNavigateOptions {
  filterPatch?: Partial<MessagesFilter>;
}

export interface TabRenderContext {
  /** Navigate to another tab, optionally pre-setting a Messages filter. */
  onNavigate: (tab: DevToolsTabId, options?: TabNavigateOptions) => void;
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
      return <MessagesLogTab store={store} />;
    case "clients":
      return <ClientsLogTab store={store} onNavigate={context.onNavigate} />;
    case "replay-buffer":
      return <ReplayBufferTab store={store} />;
    default:
      return <MessagesLogTab store={store} />;
  }
}
