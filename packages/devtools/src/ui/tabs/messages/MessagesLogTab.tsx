import { useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import type {
  MessageLogEntry,
  MessagesFilter,
  MessagesRollupConfig,
} from "../../../inspector/types";
import { MessagesToolbar } from "./components/MessagesToolbar/MessagesToolbar";
import { MessageRow } from "./components/MessageRow/MessageRow";
import { StreamRow } from "./components/StreamRow/StreamRow";
import { computeDisplayItems } from "./rollup";
import styles from "./MessagesLogTab.module.css";

export interface MessagesLogTabProps {
  store: MessageInspectorStore;
  /**
   * Auto-rollup high-frequency same-source bursts into collapsible stream
   * rows. Pass `null` to disable and always show a flat log.
   */
  rollup: MessagesRollupConfig | null;
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

export function MessagesLogTab({ store, rollup }: MessagesLogTabProps): ReactNode {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { entries, totalSeen, messagesFilter } = snapshot;

  const hasActiveFilter = Boolean(
    messagesFilter.topic ||
      messagesFilter.clientId ||
      messagesFilter.direction ||
      messagesFilter.kind ||
      messagesFilter.result,
  );

  // Apply the filter first, then group. Rollup operates on chronological
  // order so it can detect adjacency; the reverse (newest-first) happens
  // at the view layer inside the display-items mapping.
  const displayItems = useMemo(() => {
    const filtered = hasActiveFilter
      ? entries.filter((e) => matchesFilter(e, messagesFilter))
      : entries;
    const items = computeDisplayItems(filtered, rollup);
    // Reverse so newest streams / entries appear at the top of the list.
    return items.slice().reverse();
  }, [entries, messagesFilter, hasActiveFilter, rollup]);

  const visibleCount = useMemo(
    () =>
      displayItems.reduce(
        (sum, item) => sum + (item.kind === "stream" ? item.count : 1),
        0,
      ),
    [displayItems],
  );

  return (
    <div className={styles.container}>
      <MessagesToolbar
        filter={messagesFilter}
        onFilterChange={(patch) => store.setMessagesFilter(patch)}
        onClear={() => store.clearMessagesFilter()}
        onClearLog={store.clearLog}
        visibleCount={visibleCount}
        totalCount={entries.length}
        totalSeen={totalSeen}
      />

      <div role="list" className={styles.list}>
        {displayItems.map((item) =>
          item.kind === "stream" ? (
            <StreamRow key={item.key} group={item} />
          ) : (
            <MessageRow key={item.entry.id} entry={item.entry} />
          ),
        )}

        {displayItems.length === 0 && entries.length === 0 && (
          <div className={styles.empty}>No messages yet.</div>
        )}

        {displayItems.length === 0 && entries.length > 0 && hasActiveFilter && (
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
