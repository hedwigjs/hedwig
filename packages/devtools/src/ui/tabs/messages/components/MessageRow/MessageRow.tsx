import type { ReactNode } from "react";
import type { MessageLogEntry } from "../../../../../inspector/types";
import { useTopicsRegistry } from "../../../../topicsRegistry";
import { AccordionRow } from "../../../../components/AccordionRow/AccordionRow";
import { MessageSummary } from "../MessageSummary/MessageSummary";
import { MessageDetail } from "../MessageDetail/MessageDetail";
import styles from "./MessageRow.module.css";

interface MessageRowProps {
  entry: MessageLogEntry;
}

/**
 * NACK NO_SUBSCRIBERS on a trace-only topic isn't a failure — it's the
 * expected shape. Downgrade the row's `data-status` from "failed" so the
 * red border/tint doesn't fire.
 */
function effectiveStatus(
  entry: MessageLogEntry,
  isObservabilityTopic: boolean,
): string {
  if (
    isObservabilityTopic &&
    entry.result?.status === "NACK" &&
    entry.result.reason === "NO_SUBSCRIBERS"
  ) {
    return "trace";
  }
  return entry.status;
}

export function MessageRow({ entry }: MessageRowProps): ReactNode {
  const registry = useTopicsRegistry();
  const isObservabilityTopic =
    registry?.[entry.topic]?.observability === true;
  const status = effectiveStatus(entry, isObservabilityTopic);

  return (
    <AccordionRow
      rootProps={{ className: styles.row, "data-status": status }}
      summary={(open) => <MessageSummary entry={entry} open={open} />}
    >
      <MessageDetail entry={entry} />
    </AccordionRow>
  );
}
