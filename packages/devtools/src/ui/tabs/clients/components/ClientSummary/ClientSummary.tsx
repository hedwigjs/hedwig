import type { MouseEvent, ReactNode } from "react";
import type { ClientEntry } from "../../../../../inspector/types";
import type { DevToolsTabId } from "../../../../shell/layout/panelTypes";
import type { TabNavigateOptions } from "../../../renderActiveTab";
import { formatRelativeTime } from "../../../../utils/formatRelativeTime";
import styles from "./ClientSummary.module.css";

interface ClientSummaryProps {
  client: ClientEntry;
  isOpen: boolean;
  onNavigate: (tab: DevToolsTabId, options?: TabNavigateOptions) => void;
}

export function ClientSummary({ client, isOpen, onNavigate }: ClientSummaryProps): ReactNode {
  const subCount = client.subscriptions.length;

  function navigateSent(e: MouseEvent) {
    e.stopPropagation();
    onNavigate("messages", { filterPatch: { clientId: client.id, direction: "sent" } });
  }

  function navigateReceived(e: MouseEvent) {
    e.stopPropagation();
    onNavigate("messages", { filterPatch: { clientId: client.id, direction: "received" } });
  }

  return (
    <div className={styles.main}>
      <span className={styles.toggle}>{isOpen ? "−" : "+"}</span>
      <span className={styles.clientId}>{client.id}</span>
      <span className={styles.badge}>
        {subCount} topic{subCount === 1 ? "" : "s"}
      </span>

      <span className={styles.counters}>
        <span
          className={`${styles.counter} ${client.sentCount > 0 ? styles.counterSent : styles.counterZero}`}
          role="button"
          tabIndex={0}
          title={`${client.sentCount} messages sent — click to view in Messages`}
          onClick={navigateSent}
          onKeyDown={(e) => e.key === "Enter" && navigateSent(e as unknown as MouseEvent)}
        >
          ↑{client.sentCount}
        </span>
        <span
          className={`${styles.counter} ${client.receivedCount > 0 ? styles.counterReceived : styles.counterZero}`}
          role="button"
          tabIndex={0}
          title={`${client.receivedCount} messages received — click to view in Messages`}
          onClick={navigateReceived}
          onKeyDown={(e) => e.key === "Enter" && navigateReceived(e as unknown as MouseEvent)}
        >
          ↓{client.receivedCount}
        </span>
      </span>

      <span className={styles.lastActive} title="Last message activity">
        {client.lastActiveAt !== null
          ? `active ${formatRelativeTime(client.lastActiveAt)}`
          : "no activity"}
      </span>
    </div>
  );
}
