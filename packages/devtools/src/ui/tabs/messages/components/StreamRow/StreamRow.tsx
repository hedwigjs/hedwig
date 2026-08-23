import type { ReactNode } from "react";
import { AccordionRow } from "../../../../components/AccordionRow/AccordionRow";
import { MessageRow } from "../MessageRow/MessageRow";
import { formatTimestamp } from "../../formatTimestamp";
import type { StreamGroup } from "../../rollup";
import styles from "./StreamRow.module.css";

interface StreamRowProps {
  group: StreamGroup;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(2)}s`;
  return `${s.toFixed(1)}s`;
}

/**
 * Collapsible row that stands in for a burst of same-topic messages from
 * one source (typical for streaming producers like AI chat SSE chunks).
 *
 * Summary shows count + duration + latest payload preview; expanding it
 * renders every original {@link MessageRow} inside, so no information is
 * hidden — just deferred.
 */
export function StreamRow({ group }: StreamRowProps): ReactNode {
  const last = group.entries[group.entries.length - 1]!;
  const durationMs = group.lastAt - group.firstAt;

  return (
    <AccordionRow
      rootProps={{ className: styles.row, "data-status": last.status }}
      summary={(open) => (
        <>
          <div className={styles.main}>
            <span className={styles.toggle}>{open ? "−" : "+"}</span>
            <span className={styles.topic}>{group.topic}</span>
            <span className={styles.streamBadge}>stream</span>
            <span className={styles.count}>×{group.count}</span>
            <span className={styles.meta}>
              <span className={styles.time}>{formatTimestamp(last.createdAt)}</span>
            </span>
          </div>
          <div className={styles.route}>
            {group.source}
            {" → "}
            {last.target}
          </div>
          <div className={styles.sub}>
            <span className={styles.durationLabel}>burst</span>{" "}
            {formatDuration(durationMs)}
            {last.dataPreview && (
              <>
                <span className={styles.dot}> · </span>
                <span className={styles.preview}>latest: {last.dataPreview}</span>
              </>
            )}
          </div>
        </>
      )}
    >
      <div className={styles.nested}>
        {group.entries
          .slice()
          .reverse()
          .map((entry) => (
            <MessageRow key={entry.id} entry={entry} />
          ))}
      </div>
    </AccordionRow>
  );
}
