import type { ReactNode } from "react";
import type { MessageLogEntry } from "../../../../../inspector/types";
import { formatTimestamp } from "../../formatTimestamp";
import { useTopicsRegistry } from "../../../../topicsRegistry";
import styles from "./MessageSummary.module.css";

interface MessageSummaryProps {
  entry: MessageLogEntry;
  /** Passed by AccordionRow so the toggle reflects the current state. */
  open: boolean;
}

/**
 * A trace-only topic emitting NO_SUBSCRIBERS is expected, not an error.
 * We want to render such rows neutrally so they don't scream "red = broken"
 * every time a chat.message-sent.v1 fires without a listener.
 */
function isExpectedTraceNack(
  entry: MessageLogEntry,
  isObservabilityTopic: boolean,
): boolean {
  if (!isObservabilityTopic) return false;
  if (entry.result?.status !== "NACK") return false;
  return entry.result.reason === "NO_SUBSCRIBERS";
}

function formatResultLine(
  entry: MessageLogEntry,
  isExpectedNack: boolean,
): ReactNode {
  if (!entry.result) {
    return entry.status === "pending" ? "…" : "—";
  }

  const { result } = entry;
  const statusClass = isExpectedNack
    ? styles.statusTrace
    : result.status === "ACK"
      ? styles.statusAck
      : styles.statusNack;

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
  const registry = useTopicsRegistry();
  const contract = registry?.[entry.topic];
  const isObservabilityTopic = contract?.observability === true;
  const expectedNack = isExpectedTraceNack(entry, isObservabilityTopic);

  return (
    <>
      <div className={styles.main}>
        <span className={styles.toggle}>{open ? "−" : "+"}</span>
        <span className={styles.topic}>{entry.topic}</span>
        <span className={entry.kind === "unicast" ? styles.kindUnicast : styles.kindMulticast}>
          {entry.kind}
        </span>
        {isObservabilityTopic && (
          <span
            className={`${styles.pill} ${styles.pillTrace}`}
            title="Observability-only topic: NACK NO_SUBSCRIBERS is expected"
          >
            trace
          </span>
        )}
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
      <div className={styles.sub}>{formatResultLine(entry, expectedNack)}</div>
    </>
  );
}
