import { useState, type ReactNode } from "react";
import type { DevToolsPanelPosition } from "../layout/panelTypes";
import defaultMascot from "./assets/mascote.png";
import styles from "./FloatingToggleButton.module.css";

const ANCHOR: Record<DevToolsPanelPosition, string> = {
  bottom: styles.anchorBottom,
  top: styles.anchorTop,
  right: styles.anchorRight,
  left: styles.anchorLeft,
};

/**
 * Module-level flag so the startup teaser peek plays exactly once per page
 * load, regardless of how many times the panel is opened and closed. Living
 * outside React state keeps the value across FloatingToggleButton unmounts
 * (which happen every time the panel opens) but naturally resets on a full
 * page reload — matching the "first-load only" intent.
 */
let teaserPlayedThisSession = false;

export interface FloatingToggleButtonProps {
  position: DevToolsPanelPosition;
  attached: boolean;
  onOpen: () => void;
  /** Override the built-in icon (e.g. a custom img element). */
  icon?: ReactNode;
}

export const FloatingToggleButton = ({
  position,
  attached,
  onOpen,
  icon,
}: FloatingToggleButtonProps): ReactNode => {
  // useState initializer runs once per component mount. First-ever mount claims
  // the teaser; every subsequent remount sees the flag set and skips the peek.
  const [teased] = useState<boolean>(() => {
    if (teaserPlayedThisSession) return false;
    teaserPlayedThisSession = true;
    return true;
  });

  return (
    <div
      className={`${styles.anchor} ${ANCHOR[position]}${teased ? ` ${styles.teased}` : ""}`}
      data-mbdt-fab="1"
    >
      <button
        type="button"
        className={styles.btn}
        onClick={onOpen}
        title="Open message broker devtools"
        aria-label="Open message broker devtools"
      >
        {icon ?? (
          <img
            src={defaultMascot}
            alt=""
            className={styles.mascot}
            draggable={false}
          />
        )}
        <span
          className={`${styles.status} ${
            attached ? styles.statusOn : styles.statusOff
          }`}
          title={attached ? "Inspector hooked" : "Idle"}
          aria-hidden
        />
      </button>
    </div>
  );
};
