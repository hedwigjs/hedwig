import type { ReactNode } from "react";
import { AccordionRow } from "../../../../components/AccordionRow/AccordionRow";
import type { BridgeEntry } from "../../../../../inspector/types";
import styles from "./BridgeRow.module.css";

interface BridgeRowProps {
  bridge: BridgeEntry;
}

function transportBadgeClass(kind: string | undefined): string {
  switch (kind) {
    case "WebSocket":
      return styles.transportWs;
    case "SSE":
      return styles.transportSse;
    case "PostMessage":
      return styles.transportPm;
    case "BroadcastChannel":
      return styles.transportBc;
    default:
      return styles.transportOther;
  }
}

export function BridgeRow({ bridge }: BridgeRowProps): ReactNode {
  const {
    id,
    forwardPatterns,
    transportKind,
    sentThroughCount,
    receivedFromCount,
  } = bridge;
  const active = sentThroughCount + receivedFromCount > 0;

  return (
    <AccordionRow
      rootProps={{ className: styles.row, "data-active": active ? "1" : "0" }}
      summary={(open) => (
        <>
          <div className={styles.main}>
            <span className={styles.toggle}>{open ? "−" : "+"}</span>
            <span className={styles.id}>{id}</span>
            {transportKind && (
              <span
                className={`${styles.transport} ${transportBadgeClass(transportKind)}`}
                title="Transport type (from `transport.constructor.name`)"
              >
                {transportKind}
              </span>
            )}
            <span className={styles.patternsBadge}>
              {forwardPatterns.length} pattern
              {forwardPatterns.length === 1 ? "" : "s"}
            </span>
            <span className={styles.meta}>
              <span className={styles.counter} title="Local emits forwarded out (heuristic)">
                ↑{sentThroughCount}
              </span>
              <span className={styles.counter} title="External messages injected in (heuristic)">
                ↓{receivedFromCount}
              </span>
              <span
                className={active ? styles.statusActive : styles.statusIdle}
                title={active ? "Recent activity" : "No activity in current log window"}
              >
                {active ? "active" : "idle"}
              </span>
            </span>
          </div>
        </>
      )}
    >
      <div className={styles.body}>
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Forward patterns</span>
          {forwardPatterns.length === 0 ? (
            <span className={styles.dim}>(none)</span>
          ) : (
            <ul className={styles.patternsList}>
              {forwardPatterns.map((p) => (
                <li key={p} className={styles.patternItem}>
                  <code className={styles.patternCode}>{p}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Traffic (visible ring)</span>
          <div className={styles.metrics}>
            <span>
              ↑ sent through: <strong>{sentThroughCount}</strong>
            </span>
            <span>
              ↓ received from: <strong>{receivedFromCount}</strong>
            </span>
          </div>
        </div>
      </div>
    </AccordionRow>
  );
}
