import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import { BridgeRow } from "./components/BridgeRow/BridgeRow";
import styles from "./BridgesTab.module.css";

export interface BridgesTabProps {
  store: MessageInspectorStore;
}

export function BridgesTab({ store }: BridgesTabProps): ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const { bridges } = snapshot;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {bridges.length} bridge{bridges.length === 1 ? "" : "s"}
        </span>
        <span className={styles.headerHint}>
          Transports registered via{" "}
          <code className={styles.code}>broker.addBridge(id, {"{ transport, forward }"})</code>.
          Counters are approximate — derived from the visible message ring
          by matching topic against forward patterns.
        </span>
      </div>

      <div role="list" className={styles.list}>
        {bridges.map((bridge) => (
          <BridgeRow key={bridge.id} bridge={bridge} />
        ))}

        {bridges.length === 0 && (
          <div className={styles.empty}>
            No bridges registered. Call{" "}
            <code className={styles.code}>broker.addBridge(...)</code> from the
            host to hook a transport into the broker.
          </div>
        )}
      </div>
    </div>
  );
}
