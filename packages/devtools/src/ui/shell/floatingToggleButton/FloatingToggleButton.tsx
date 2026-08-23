import type { ReactNode } from "react";
import type { DevToolsPanelPosition } from "../layout/panelTypes";
import defaultMascot from "./assets/mascote.png";
import styles from "./FloatingToggleButton.module.css";

const ANCHOR: Record<DevToolsPanelPosition, string> = {
  bottom: styles.anchorBottom,
  top: styles.anchorTop,
  right: styles.anchorRight,
  left: styles.anchorLeft,
};

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
}: FloatingToggleButtonProps): ReactNode => (
  <div className={`${styles.anchor} ${ANCHOR[position]}`} data-mbdt-fab="1">
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
