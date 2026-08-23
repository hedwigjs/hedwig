import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  TopicContractInfo,
  TopicsRegistry,
} from "../../../../topicsRegistry";
import styles from "./TopicPicker.module.css";

interface TopicPickerProps {
  value: string;
  registry: TopicsRegistry | null;
  onTextChange: (value: string) => void;
  onPick: (contract: TopicContractInfo) => void;
}

/**
 * Text input + suggestion dropdown over the topics registry. Free-form
 * typing works even without a registry (dropdown just stays empty).
 * Selecting an entry fires `onPick` so the parent can prefill the
 * payload editor from `examples.happy`.
 */
export function TopicPicker({
  value,
  registry,
  onTextChange,
  onPick,
}: TopicPickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const suggestions = useMemo(() => {
    if (!registry) return [];
    const q = value.trim().toLowerCase();
    const all = Object.values(registry);
    if (!q) return all.slice(0, 20);
    return all
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [registry, value]);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <input
        className={styles.input}
        value={value}
        onChange={(e) => {
          onTextChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={
          registry
            ? "Type to search topics from the registry…"
            : "Type a topic (no registry configured)"
        }
        spellCheck={false}
      />
      {open && suggestions.length > 0 && (
        <ul className={styles.dropdown} role="listbox">
          {suggestions.map((c) => (
            <li
              key={c.name}
              className={styles.item}
              role="option"
              aria-selected={c.name === value}
              onMouseDown={(e) => {
                // Prevent input blur before the click registers.
                e.preventDefault();
                onPick(c);
                setOpen(false);
              }}
            >
              <div className={styles.itemName}>{c.name}</div>
              <div className={styles.itemDesc}>{c.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
