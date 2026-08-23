import type { ReactNode } from "react";
import type { MessageLogEntry } from "../../../../../inspector/types";
import { formatTimestamp } from "../../formatTimestamp";
import styles from "./MessageSummary.module.css";

interface MessageSummaryProps {
  entry: MessageLogEntry;
  /** Passed by AccordionRow so the toggle reflects the current state. */
  open: boolean;
}

function formatResultLine(entry: MessageLogEntry): ReactNode {
  if (!entry.result) {
    return entry.status === "pending" ? "…" : "—";
  }

  const { result } = entry;
  const statusClass = result.status === "ACK" ? styles.statusAck : styles.statusNack;

  const suffix =
    entry.kind === "multicast"
      ? entry.subscriberCount != null
        ? ` → ${entry.subscriberCount} subscriber${entry.subscriberCount === 1 ? "" : "s"}`
        : ""
      : result.message
        ? ` · ${result.message}`
        : "";

  return (
    <>
      <span className={statusClass}>
        {result.status} {result.reason}
      </span>
      {suffix}
    </>
  );
}

export function MessageSummary({ entry, open }: MessageSummaryProps): ReactNode {
  return (
    <>
      <div className={styles.main}>
        <span className={styles.toggle}>{open ? "−" : "+"}</span>
        <span className={styles.topic}>{entry.topic}</span>
        <span className={entry.kind === "unicast" ? styles.kindUnicast : styles.kindMulticast}>
          {entry.kind}
        </span>
        {entry.replayed && <span className={styles.pill}>replay</span>}
        {entry.fromExternal && <span className={styles.pill}>external</span>}
        {entry.synthetic && (
          <span className={`${styles.pill} ${styles.pillSynthetic}`}>synthetic</span>
        )}
        <span className={styles.meta}>
          <span className={styles.time}>{formatTimestamp(entry.createdAt)}</span>
        </span>
      </div>
      <div className={styles.route}>
        {entry.source}
        {" → "}
        {entry.target}
      </div>
      <div className={styles.sub}>{formatResultLine(entry)}</div>
    </>
  );
}
