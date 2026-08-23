import type { ReactNode } from "react";
import type { MessageLogEntry } from "../../../../../inspector/types";
import { AccordionRow } from "../../../../components/AccordionRow/AccordionRow";
import { MessageSummary } from "../MessageSummary/MessageSummary";
import { MessageDetail } from "../MessageDetail/MessageDetail";
import styles from "./MessageRow.module.css";

interface MessageRowProps {
  entry: MessageLogEntry;
}

export function MessageRow({ entry }: MessageRowProps): ReactNode {
  return (
    <AccordionRow
      rootProps={{ className: styles.row, "data-status": entry.status }}
      summary={(open) => <MessageSummary entry={entry} open={open} />}
    >
      <MessageDetail entry={entry} />
    </AccordionRow>
  );
}
