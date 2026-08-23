import { useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import type { HistoryEntry } from "../../../inspector/types";
import { HistoryEntryRow } from "./components/HistoryEntryRow/HistoryEntryRow";
import styles from "./ReplayBufferTab.module.css";

export interface ReplayBufferTabProps {
  store: MessageInspectorStore;
}

/** Group entries by topic, preserving insertion order of first occurrence. */
function groupByTopic(entries: ReadonlyArray<HistoryEntry>): Map<string, HistoryEntry[]> {
  const map = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const topic = String(entry.message.topic);
    let group = map.get(topic);
    if (!group) {
      group = [];
      map.set(topic, group);
    }
    group.push(entry);
  }
  return map;
}

export function ReplayBufferTab({ store }: ReplayBufferTabProps): ReactNode {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { historyEntries } = snapshot;

  const grouped = useMemo(
    () => groupByTopic(historyEntries),
    [historyEntries],
  );

  if (historyEntries.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Replay buffer is empty.</div>
        <div className={styles.emptyHint}>
          Messages are stored here when published with{" "}
          <code className={styles.code}>{"{ history: true }"}</code> and history is enabled in{" "}
          <code className={styles.code}>BrokerConfig</code>.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {historyEntries.length} message{historyEntries.length === 1 ? "" : "s"} stored across{" "}
          {grouped.size} topic{grouped.size === 1 ? "" : "s"}
        </span>
        <span className={styles.headerHint}>
          New subscribers with <code className={styles.code}>replay</code> will receive these.
        </span>
      </div>

      <div className={styles.groups}>
        {Array.from(grouped.entries()).map(([topic, entries]) => (
          <div key={topic} className={styles.group}>
            <div className={styles.groupHeader}>
              <span className={styles.groupTopic}>{topic}</span>
              <span className={styles.groupCount}>
                {entries.length} msg{entries.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className={styles.groupEntries}>
              {entries.map((entry) => (
                <HistoryEntryRow key={entry.sequence} entry={entry} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
