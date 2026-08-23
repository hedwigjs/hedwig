import { useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./AccordionRow.module.css";

interface AccordionRowProps {
  /** Collapsed content — receives `open` so it can render the chevron. */
  summary: (open: boolean) => ReactNode;
  /** Detail content shown when the row is expanded. */
  children: ReactNode;
  /** Props forwarded to the root `<div>` (e.g. className, data-*). */
  rootProps?: ComponentPropsWithoutRef<"div"> & {
    [key: `data-${string}`]: string | undefined;
  };
}

export function AccordionRow({
  summary,
  children,
  rootProps,
}: AccordionRowProps): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <div {...rootProps}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {summary(open)}
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </div>
  );
}
