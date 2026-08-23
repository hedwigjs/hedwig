import { useState } from "react";
import type { ReactNode } from "react";
import type { MessageLogEntry } from "../../../../../inspector/types";
import styles from "./MessageDetail.module.css";

interface MessageDetailProps {
  entry: MessageLogEntry;
}

function CopyableCode({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={styles.codeWrap}>
      <pre className={styles.code}>{text}</pre>
      <button
        type="button"
        className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ""}`}
        onClick={handleCopy}
        title="Copy to clipboard"
        aria-label="Copy to clipboard"
      >
        {copied ? "✓" : "⎘"}
      </button>
    </div>
  );
}

export function MessageDetail({ entry }: MessageDetailProps): ReactNode {
  return (
    <dl className={styles.grid}>
      <div className={styles.row}>
        <dt>ID</dt>
        <dd>{entry.id}</dd>
      </div>

      <div className={styles.row}>
        <dt>Source</dt>
        <dd>{entry.source}</dd>
      </div>

      {entry.kind === "unicast" && (
        <div className={styles.row}>
          <dt>Recipient</dt>
          <dd>{entry.result?.recipientId ?? entry.target}</dd>
        </div>
      )}

      {entry.kind === "multicast" && (
        <div className={styles.row}>
          <dt>Recipients</dt>
          <dd>
            {entry.result?.recipientIds && entry.result.recipientIds.length > 0 ? (
              <ul className={styles.recipientList}>
                {entry.result.recipientIds.map((id) => (
                  <li key={id} className={styles.recipientItem}>{id}</li>
                ))}
              </ul>
            ) : (
              entry.subscriberCount != null
                ? `${entry.subscriberCount} subscriber${entry.subscriberCount === 1 ? "" : "s"}`
                : "—"
            )}
          </dd>
        </div>
      )}

      {entry.kind === "unicast" && entry.latencyMs != null && (
        <div className={styles.row}>
          <dt>Latency</dt>
          <dd>{entry.latencyMs}ms (round-trip)</dd>
        </div>
      )}

      {entry.result && (
        <div className={styles.row}>
          <dt>Result</dt>
          <dd>
            <span className={entry.result.status === "ACK" ? styles.statusAck : styles.statusNack}>
              {entry.result.status} {entry.result.reason}
            </span>
            {entry.result.message ? ` · ${entry.result.message}` : ""}
          </dd>
        </div>
      )}

      {entry.dataPreview && (
        <div className={styles.row}>
          <dt>Payload</dt>
          <dd>
            <CopyableCode text={entry.dataPreview} />
          </dd>
        </div>
      )}

      {entry.result?.responsePreview && (
        <div className={styles.row}>
          <dt>Response</dt>
          <dd>
            <CopyableCode text={entry.result.responsePreview} />
          </dd>
        </div>
      )}
    </dl>
  );
}
