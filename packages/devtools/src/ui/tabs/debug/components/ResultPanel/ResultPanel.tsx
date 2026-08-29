import type { ReactNode } from "react";
import type { RoutingResult } from "@hedwigjs/broker";
import styles from "./ResultPanel.module.css";

interface ResultPanelProps {
  result: RoutingResult;
  mode: "multicast" | "unicast";
}

/**
 * Shows the RoutingResult from broker.$debug.send — status, reason,
 * subscribers count (multicast) or response data (unicast).
 */
export function ResultPanel({ result, mode }: ResultPanelProps): ReactNode {
  const ok = result.status === "ACK";
  return (
    <div className={styles.panel} data-ok={ok ? "1" : "0"}>
      <div className={styles.header}>
        <span className={ok ? styles.statusAck : styles.statusNack}>
          {result.status}
        </span>
        <span className={styles.reason}>{String(result.reason)}</span>
        {result.message && <span className={styles.msg}>· {result.message}</span>}
      </div>

      {mode === "multicast" && result.recipientIds && (
        <div className={styles.section}>
          <span className={styles.label}>Delivered to</span>
          <div className={styles.recipients}>
            {result.recipientIds.length === 0 ? (
              <span className={styles.dim}>(none)</span>
            ) : (
              result.recipientIds.map((id) => (
                <code key={id} className={styles.chip}>
                  {id}
                </code>
              ))
            )}
          </div>
        </div>
      )}

      {mode === "unicast" && ok && result.recipientId && (
        <div className={styles.section}>
          <span className={styles.label}>Handled by</span>
          <code className={styles.chip}>{result.recipientId}</code>
        </div>
      )}

      {result.data !== undefined && (
        <div className={styles.section}>
          <span className={styles.label}>Response data</span>
          <pre className={styles.payload}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
