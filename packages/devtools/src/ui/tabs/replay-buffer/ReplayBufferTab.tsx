import { useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import type { HistoryEntry } from "../../../inspector/types";
import { HistoryEntryRow } from "./components/HistoryEntryRow/HistoryEntryRow";
import styles from "./ReplayBufferTab.module.css";

export interface ReplayBufferTabProps {
  store: MessageInspectorStore;
}

/**
 * Group entries by topic, newest → oldest within each group. Groups themselves
 * are ordered by their newest entry (descending), so the topic with the
 * most-recent activity floats to the top of the tab.
 *
 * Broker's `inspect.getHistory()` returns entries in insertion order
 * (oldest → newest); flipping here is a pure view-layer concern.
 */
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
  for (const group of map.values()) {
    group.sort((a, b) => b.sequence - a.sequence);
  }
  const sortedGroups = Array.from(map.entries()).sort(
    ([, aEntries], [, bEntries]) =>
      (bEntries[0]?.sequence ?? 0) - (aEntries[0]?.sequence ?? 0),
  );
  return new Map(sortedGroups);
}

export function ReplayBufferTab({ store }: ReplayBufferTabProps): ReactNode {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { historyEntries, historyStats } = snapshot;

  const grouped = useMemo(
    () => groupByTopic(historyEntries),
    [historyEntries],
  );

  const declared = historyStats.topics;

  if (declared.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Nothing is retained.</div>
        <div className={styles.emptyHint}>
          A topic keeps recent messages only when its contract says so:{" "}
          <code className={styles.code}>{"retention: { last: N }"}</code> on an event, or{" "}
          <code className={styles.code}>{'kind: "state"'}</code> for a current value. The host passes
          the registry with <code className={styles.code}>{"initBroker({ topics: TOPIC_KINDS })"}</code>.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {historyStats.count} message{historyStats.count === 1 ? "" : "s"} retained across{" "}
          {declared.length} topic{declared.length === 1 ? "" : "s"}
        </span>
        <span className={styles.headerHint}>
          {historyStats.enabled
            ? "Declared in the contracts. Subscribers with replay receive these; a state value goes to every new subscriber."
            : "Event retention is switched off by the host (history.enabled: false); only state values are kept."}
        </span>
      </div>

      <div className={styles.groups}>
        {declared.map((info) => {
          const entries = grouped.get(info.topic) ?? [];
          return (
            <div key={info.topic} className={styles.group} data-mbdt-retained={info.topic}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTopic}>{info.topic}</span>
                <span
                  className={info.kind === "state" ? styles.kindState : styles.kindEvent}
                  data-mbdt-kind={info.kind}
                  title={
                    info.kind === "state"
                      ? "state: the last value, handed to every new subscriber"
                      : `event: the last ${info.limit} kept for subscribers that ask for replay`
                  }
                >
                  {info.kind}
                </span>
                <span className={styles.groupCount}>
                  {info.count} of {info.limit}
                </span>
              </div>
              {entries.length > 0 && (
                <div className={styles.groupEntries}>
                  {entries.map((entry) => (
                    <HistoryEntryRow key={entry.sequence} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
