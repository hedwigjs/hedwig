import type { ReactNode } from "react";
import type { ClientEntry } from "../../../../../inspector/types";
import type { DevToolsTabId } from "../../../../shell/layout/panelTypes";
import type { TabNavigateOptions } from "../../../renderActiveTab";
import { formatRelativeTime } from "../../../../utils/formatRelativeTime";
import styles from "./ClientDetail.module.css";

interface ClientDetailProps {
  client: ClientEntry;
  onNavigate: (tab: DevToolsTabId, options?: TabNavigateOptions) => void;
}

export function ClientDetail({ client, onNavigate }: ClientDetailProps): ReactNode {
  const connectedDate = new Date(client.connectedAt);

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.metaLabel}>Connected</span>
          <span className={styles.metaValue} title={connectedDate.toISOString()}>
            {connectedDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 })}
          </span>
        </div>
      </div>

      {/* Activity row */}
      <div className={styles.activity}>
        <button
          type="button"
          className={`${styles.activityBtn} ${styles.activityBtnSent}`}
          disabled={client.sentCount === 0}
          onClick={() =>
            onNavigate("messages", { filterPatch: { clientId: client.id, direction: "sent" } })
          }
          title={
            client.sentCount > 0
              ? "Show messages sent by this client"
              : "No messages sent"
          }
        >
          <span className={styles.activityArrow}>↑</span>
          <span className={styles.activityCount}>{client.sentCount}</span>
          <span className={styles.activityLabel}>sent</span>
        </button>

        <button
          type="button"
          className={`${styles.activityBtn} ${styles.activityBtnReceived}`}
          disabled={client.receivedCount === 0}
          onClick={() =>
            onNavigate("messages", {
              filterPatch: { clientId: client.id, direction: "received" },
            })
          }
          title={
            client.receivedCount > 0
              ? "Show messages received by this client"
              : "No messages received"
          }
        >
          <span className={styles.activityArrow}>↓</span>
          <span className={styles.activityCount}>{client.receivedCount}</span>
          <span className={styles.activityLabel}>received</span>
        </button>

        <button
          type="button"
          className={styles.showAllBtn}
          disabled={client.sentCount === 0 && client.receivedCount === 0}
          onClick={() =>
            onNavigate("messages", { filterPatch: { clientId: client.id, direction: undefined } })
          }
          title="Show all messages involving this client"
        >
          → all activity
        </button>
      </div>

      {client.subscriptions.length > 0 && (
        <div className={styles.subscriptions}>
          <div className={styles.subsTitle}>Subscriptions</div>
          {client.subscriptions.map((sub) => (
            <div key={sub.topic} className={styles.subRow}>
              <div className={styles.subTopic}>{sub.topic}</div>
              <div className={styles.subMeta}>
                {sub.options?.backpressure != null && (
                  <span className={styles.subOption} title="Backpressure limit">
                    bp:{String(sub.options.backpressure)}
                  </span>
                )}
                <span
                  className={`${styles.subReceived} ${sub.lastReceivedAt === null ? styles.subReceivedNever : ""}`}
                  title="Last received"
                >
                  {sub.lastReceivedAt !== null
                    ? `received ${formatRelativeTime(sub.lastReceivedAt)}`
                    : "never received"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {client.subscriptions.length === 0 && (
        <div className={styles.noSubs}>No active subscriptions.</div>
      )}
    </div>
  );
}
