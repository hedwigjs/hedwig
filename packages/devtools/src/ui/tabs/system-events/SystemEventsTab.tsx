import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import { SystemEventRow } from "./components/SystemEventRow/SystemEventRow";
import styles from "./SystemEventsTab.module.css";

export interface SystemEventsTabProps {
  store: MessageInspectorStore;
}

export function SystemEventsTab({ store }: SystemEventsTabProps): ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const { systemEvents } = snapshot;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {systemEvents.length} event{systemEvents.length === 1 ? "" : "s"}
        </span>
        <span className={styles.headerHint}>
          Broker infrastructure signals — client, subscription, and bridge
          lifecycle from{" "}
          <code className={styles.code}>broker.$systemEvents</code>. Not user
          messages.
        </span>
        <button
          type="button"
          className={styles.clearBtn}
          onClick={store.clearSystemEvents}
          disabled={systemEvents.length === 0}
        >
          Clear
        </button>
      </div>

      <div role="list" className={styles.list}>
        {systemEvents
          .slice()
          .reverse()
          .map((entry) => (
            <SystemEventRow key={entry.id} entry={entry} />
          ))}

        {systemEvents.length === 0 && (
          <div className={styles.empty}>
            No system events yet. Register a client or add a bridge to see events here.
          </div>
        )}
      </div>
    </div>
  );
}
