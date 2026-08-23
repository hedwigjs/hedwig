import type { ChangeEvent, ReactNode } from "react";
import type {
  MessagesFilter,
  MessageKind,
} from "../../../../../inspector/types";
import styles from "./MessagesToolbar.module.css";

interface MessagesToolbarProps {
  filter: MessagesFilter;
  onFilterChange: (patch: Partial<MessagesFilter>) => void;
  onClear: () => void;
  onClearLog: () => void;
  visibleCount: number;
  totalCount: number;
  totalSeen: number;
}

const KIND_OPTIONS: MessageKind[] = ["multicast", "unicast"];
const RESULT_OPTIONS: Array<NonNullable<MessagesFilter["result"]>> = [
  "ACK",
  "NACK",
  "pending",
];

export function MessagesToolbar({
  filter,
  onFilterChange,
  onClear,
  onClearLog,
  visibleCount,
  totalCount,
  totalSeen,
}: MessagesToolbarProps): ReactNode {
  function handleTopicInput(e: ChangeEvent<HTMLInputElement>) {
    onFilterChange({ topic: e.target.value });
  }

  const activeChips: Array<{ key: keyof MessagesFilter; label: string }> = [];
  if (filter.clientId) {
    const dirLabel = filter.direction ? ` · ${filter.direction}` : "";
    activeChips.push({
      key: "clientId",
      label: `client: ${filter.clientId}${dirLabel}`,
    });
  }
  if (filter.direction && !filter.clientId) {
    activeChips.push({ key: "direction", label: filter.direction });
  }
  if (filter.kind) activeChips.push({ key: "kind", label: filter.kind });
  if (filter.result) activeChips.push({ key: "result", label: filter.result });

  const hasAnyFilter =
    filter.topic ||
    filter.clientId ||
    filter.direction ||
    filter.kind ||
    filter.result;
  const isFiltered = hasAnyFilter && visibleCount !== totalCount;

  // Show overflow indicator when ring buffer has wrapped
  const dropped = totalSeen - totalCount;

  return (
    <div className={styles.toolbar}>
      <div className={styles.row}>
        <div className={styles.filterWrap}>
          <span className={styles.filterIcon}>⌕</span>
          <input
            className={styles.filterInput}
            type="text"
            placeholder="Filter by topic…"
            value={filter.topic}
            onChange={handleTopicInput}
            spellCheck={false}
            aria-label="Filter messages by topic"
          />
          {filter.topic && (
            <button
              type="button"
              className={styles.filterClear}
              onClick={() => onFilterChange({ topic: "" })}
              aria-label="Clear topic filter"
            >
              ×
            </button>
          )}
        </div>

        <span
          className={styles.counter}
          title={
            dropped > 0
              ? `${dropped} older messages dropped (ring buffer full)`
              : undefined
          }
        >
          {isFiltered ? (
            <>
              {visibleCount}{" "}
              <span className={styles.counterDim}>/ {totalCount}</span>
            </>
          ) : (
            <>{totalCount}</>
          )}
          {dropped > 0 && (
            <span
              className={styles.counterDropped}
              title={`${dropped} messages dropped`}
            >
              +{dropped > 999 ? "999+" : dropped} dropped
            </span>
          )}
        </span>

        <button
          type="button"
          className={styles.clearLogBtn}
          onClick={onClearLog}
          title="Clear all messages"
          aria-label="Clear all messages"
        >
          Clear all messages
        </button>
      </div>

      <div className={styles.quickFilters}>
        {KIND_OPTIONS.map((k) => (
          <button
            key={k}
            type="button"
            className={`${styles.quickBtn} ${filter.kind === k ? styles.quickBtnActive : ""}`}
            onClick={() =>
              onFilterChange({ kind: filter.kind === k ? undefined : k })
            }
          >
            {k}
          </button>
        ))}
        {RESULT_OPTIONS.map((r) => (
          <button
            key={r}
            type="button"
            className={`${styles.quickBtn} ${filter.result === r ? styles.quickBtnActive : ""}`}
            onClick={() =>
              onFilterChange({ result: filter.result === r ? undefined : r })
            }
          >
            {r}
          </button>
        ))}
        {hasAnyFilter && (
          <button
            type="button"
            className={styles.clearAllBtn}
            onClick={onClear}
            aria-label="Clear all filters"
          >
            ✕ clear filters
          </button>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className={styles.chips}>
          {activeChips.map(({ key, label }) => (
            <span key={key} className={styles.chip}>
              {label}
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() =>
                  key === "clientId"
                    ? onFilterChange({
                        clientId: undefined,
                        direction: undefined,
                      })
                    : onFilterChange({ [key]: undefined })
                }
                aria-label={`Remove ${key} filter`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
