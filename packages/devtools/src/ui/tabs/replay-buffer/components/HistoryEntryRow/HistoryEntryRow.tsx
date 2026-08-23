import { useState } from "react";
import type { ReactNode } from "react";
import type { HistoryEntry } from "../../../../../inspector/types";
import { serializeDataPreview } from "../../../../../inspector/types";
import styles from "./HistoryEntryRow.module.css";

interface HistoryEntryRowProps {
  entry: HistoryEntry;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function HistoryEntryRow({ entry }: HistoryEntryRowProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const preview = serializeDataPreview(entry.message.data);

  function handleCopy() {
    navigator.clipboard.writeText(preview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.summary}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.toggle}>{open ? "−" : "+"}</span>
        <span className={styles.seq}>#{entry.sequence}</span>
        <span className={styles.source}>{entry.message.source}</span>
        <span className={styles.time}>{formatTime(entry.timestamp)}</span>
        {preview !== "undefined" && (
          <span className={styles.previewClip}>{preview}</span>
        )}
      </button>

      {open && (
        <div className={styles.detail}>
          <div className={styles.detailGrid}>
            <span className={styles.dt}>Source</span>
            <span className={styles.dd}>{entry.message.source}</span>

            <span className={styles.dt}>Sequence</span>
            <span className={styles.dd}>#{entry.sequence}</span>

            <span className={styles.dt}>Stored at</span>
            <span className={styles.dd} title={new Date(entry.timestamp).toISOString()}>
              {formatTime(entry.timestamp)}
            </span>
          </div>

          {preview !== "undefined" && (
            <div className={styles.payloadWrap}>
              <span className={styles.dt}>Payload</span>
              <div className={styles.codeWrap}>
                <pre className={styles.code}>{preview}</pre>
                <button
                  type="button"
                  className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ""}`}
                  onClick={handleCopy}
                  title="Copy to clipboard"
                >
                  {copied ? "✓" : "⎘"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
