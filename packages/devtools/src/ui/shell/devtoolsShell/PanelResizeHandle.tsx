import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { DevToolsPanelPosition } from "../layout/panelTypes";
import { clampSizeMain } from "../layout/panelFrame";
import styles from "./PanelResizeHandle.module.css";

/**
 * Which panel edge the resize handle sits on (matches top/bottom/left/right in CSS terms).
 */
type ResizeHandleEdge = "top" | "bottom" | "left" | "right";

const RESIZE_EDGE_BY_DOCK: Record<DevToolsPanelPosition, ResizeHandleEdge> = {
  bottom: "top",
  top: "bottom",
  left: "right",
  right: "left",
};

const EDGE_CLASS: Record<ResizeHandleEdge, string> = {
  top: styles.edgeTop,
  bottom: styles.edgeBottom,
  left: styles.edgeLeft,
  right: styles.edgeRight,
};

/**
 * Returns the panel's main-axis size in px from the current pointer position.
 * top/bottom panels → height, left/right panels → width.
 */
function mainSizeFromPointer(
  edge: ResizeHandleEdge,
  clientX: number,
  clientY: number,
): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  switch (edge) {
    case "top":
      return h - clientY;
    case "bottom":
      return clientY;
    case "right":
      return clientX;
    case "left":
      return w - clientX;
    default:
      return 0;
  }
}

export interface PanelResizeHandleProps {
  position: DevToolsPanelPosition;
  onResize: (mainPx: number) => void;
  disabled: boolean;
}

export const PanelResizeHandle = ({
  position,
  onResize,
  disabled,
}: PanelResizeHandleProps): ReactNode => {
  const drag = useRef(false);
  const edge = RESIZE_EDGE_BY_DOCK[position];
  const posRef = useRef(position);
  posRef.current = position;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled) {
        return;
      }
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = true;
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!drag.current || disabled) {
        return;
      }
      const p = posRef.current;
      const main = mainSizeFromPointer(RESIZE_EDGE_BY_DOCK[p], e.clientX, e.clientY);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      onResize(clampSizeMain(p, main, vw, vh));
    },
    [disabled, onResize],
  );

  const end = useCallback((e: ReactPointerEvent) => {
    if (drag.current) {
      drag.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  }, []);

  if (disabled) {
    return null;
  }

  const isHorizontal = edge === "top" || edge === "bottom";

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? "horizontal" : "vertical"}
      className={`${styles.handle} ${EDGE_CLASS[edge]}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
};
