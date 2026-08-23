import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./SourcePicker.module.css";

interface SourcePickerProps {
  value: string;
  /** Registered client ids for dropdown suggestions. */
  suggestions: ReadonlyArray<string>;
  onChange: (value: string) => void;
  /** Placeholder shown when the input is empty. */
  placeholder?: string;
}

/**
 * Text input with a dropdown that opens on focus.
 *
 * Same interaction model as TopicPicker: pick from the list OR type a
 * free string. Free strings are allowed on purpose — the whole point of
 * `broker.$debug.send` is that source is an arbitrary label, not
 * restricted to registered clients (bridges use non-client source labels
 * like `ai-backend`, `notifications-backend`).
 */
export function SourcePicker({
  value,
  suggestions,
  onChange,
  placeholder,
}: SourcePickerProps): ReactNode {
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

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions;
    // When value is an exact match of one of the suggestions, the user
    // most likely wants to browse the full list — not see a filter
    // narrowed down to just that one entry. Only apply substring
    // filtering when the user is actively refining (partial input).
    const isExact = suggestions.some((id) => id.toLowerCase() === q);
    if (isExact) return suggestions;
    return suggestions.filter((id) => id.toLowerCase().includes(q));
  }, [suggestions, value]);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <input
        className={styles.input}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        spellCheck={false}
      />
      <button
        type="button"
        className={styles.caret}
        aria-label={open ? "Close options" : "Open options"}
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        ▾
      </button>
      {open && filtered.length > 0 && (
        <ul className={styles.dropdown} role="listbox">
          {filtered.map((id) => (
            <li
              key={id}
              className={styles.item}
              role="option"
              aria-selected={id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(id);
                setOpen(false);
              }}
            >
              <code className={styles.itemName}>{id}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
