import { useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import type { MessageLogEntry, MessagesFilter } from "../../../inspector/types";
import { MessagesToolbar } from "./components/MessagesToolbar/MessagesToolbar";
import { MessageRow } from "./components/MessageRow/MessageRow";
import styles from "./MessagesLogTab.module.css";

export interface MessagesLogTabProps {
  store: MessageInspectorStore;
}

function matchesFilter(entry: MessageLogEntry, filter: MessagesFilter): boolean {
  if (filter.topic && !entry.topic.toLowerCase().includes(filter.topic.toLowerCase())) {
    return false;
  }
  if (filter.clientId) {
    const isSource = entry.source === filter.clientId;
    const isUnicastRecipient = entry.result?.recipientId === filter.clientId;
    const isMulticastRecipient = entry.result?.recipientIds?.includes(filter.clientId) ?? false;
    const isRecipient = isUnicastRecipient || isMulticastRecipient;

    if (filter.direction === "sent") {
      if (!isSource) return false;
    } else if (filter.direction === "received") {
      if (!isRecipient) return false;
    } else {
      if (!isSource && !isRecipient) return false;
    }
  }
  if (filter.kind && entry.kind !== filter.kind) return false;
  if (filter.result) {
    if (filter.result === "pending" && entry.status !== "pending") return false;
    if (filter.result === "ACK" && entry.result?.status !== "ACK") return false;
    if (filter.result === "NACK" && entry.result?.status !== "NACK") return false;
  }
  return true;
}

export function MessagesLogTab({ store }: MessagesLogTabProps): ReactNode {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { entries, totalSeen, messagesFilter } = snapshot;

  const visibleEntries = useMemo(() => {
    const reversed = entries.slice().reverse();
    const hasActiveFilter =
      messagesFilter.topic ||
      messagesFilter.clientId ||
      messagesFilter.kind ||
      messagesFilter.result;
    return hasActiveFilter ? reversed.filter((e) => matchesFilter(e, messagesFilter)) : reversed;
  }, [entries, messagesFilter]);

  const hasActiveFilter = Boolean(
    messagesFilter.topic ||
      messagesFilter.clientId ||
      messagesFilter.direction ||
      messagesFilter.kind ||
      messagesFilter.result,
  );

  return (
    <div className={styles.container}>
      <MessagesToolbar
        filter={messagesFilter}
        onFilterChange={(patch) => store.setMessagesFilter(patch)}
        onClear={() => store.clearMessagesFilter()}
        onClearLog={store.clearLog}
        visibleCount={visibleEntries.length}
        totalCount={entries.length}
        totalSeen={totalSeen}
      />

      <div role="list" className={styles.list}>
        {visibleEntries.map((e) => (
          <MessageRow key={e.id} entry={e} />
        ))}

        {visibleEntries.length === 0 && entries.length === 0 && (
          <div className={styles.empty}>No messages yet.</div>
        )}

        {visibleEntries.length === 0 && entries.length > 0 && hasActiveFilter && (
          <div className={styles.empty}>
            No messages match the current filter.
            <button
              type="button"
              className={styles.emptyReset}
              onClick={() => store.clearMessagesFilter()}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
