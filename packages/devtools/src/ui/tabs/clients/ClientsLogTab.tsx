import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import type { DevToolsTabId } from "../../shell/layout/panelTypes";
import type { TabNavigateOptions } from "../renderActiveTab";
import { ClientCard } from "./components/ClientCard/ClientCard";
import styles from "./ClientsLogTab.module.css";

export interface ClientsLogTabProps {
  store: MessageInspectorStore;
  onNavigate: (tab: DevToolsTabId, options?: TabNavigateOptions) => void;
}

export function ClientsLogTab({ store, onNavigate }: ClientsLogTabProps): ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const { clients } = snapshot;

  if (clients.length === 0) {
    return (
      <div className={styles.empty}>
        No clients connected yet.
      </div>
    );
  }

  return (
    <div role="list" className={styles.list}>
      {clients.map((client) => (
        <ClientCard key={client.id} client={client} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
