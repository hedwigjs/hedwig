import type { DevToolsPanelPosition } from "./panelTypes";

export const DEFAULT_SIZE_MAIN: Record<DevToolsPanelPosition, number> = {
  bottom: 400,
  top: 400,
  left: 420,
  right: 420,
};

export const MIN_SIZE_MAIN = 200;

export function getMaxSizeMain(
  position: DevToolsPanelPosition,
  viewportW: number,
  viewportH: number,
): number {
  const isHorizontal = position === "left" || position === "right";
  return Math.floor(0.95 * (isHorizontal ? viewportW : viewportH));
}

export function clampSizeMain(
  position: DevToolsPanelPosition,
  px: number,
  viewportW: number,
  viewportH: number,
): number {
  const max = getMaxSizeMain(position, viewportW, viewportH);
  return Math.max(MIN_SIZE_MAIN, Math.min(max, Math.round(px)));
}
