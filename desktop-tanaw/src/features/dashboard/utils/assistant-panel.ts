/** The window edge the TANAW Insights panel is docked against; its resize handle is its other edge. */
export type DockSide = "left" | "right";

/** A width kept between the panel's minimum and maximum; a maximum below the minimum gives the minimum. */
export function clampPanelWidth(width: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(Math.max(min, max), width)));
}

/**
 * The panel's width while its inner edge is dragged. The width changes by how far the pointer has
 * moved since it pressed, toward the middle of the window to widen, so the edge follows the pointer
 * on either side and never jumps when pressed a few pixels off the edge.
 */
export function dragPanelWidth({ side, startWidth, startX, clientX, min, max }: { side: DockSide; startWidth: number; startX: number; clientX: number; min: number; max: number }) {
  const moved = side === "right" ? startX - clientX : clientX - startX;
  return clampPanelWidth(startWidth + moved, min, max);
}

/**
 * The width an arrow key, Home or End gives the resize handle: the arrow toward the middle of the
 * window widens, the other narrows; Home is the widest, End the narrowest. Null for any other key.
 */
export function keyPanelWidth({ key, side, width, step, min, max }: { key: string; side: DockSide; width: number; step: number; min: number; max: number }) {
  const wider = side === "right" ? "ArrowLeft" : "ArrowRight";
  const narrower = side === "right" ? "ArrowRight" : "ArrowLeft";
  if (key === wider) return clampPanelWidth(width + step, min, max);
  if (key === narrower) return clampPanelWidth(width - step, min, max);
  if (key === "Home") return clampPanelWidth(max, min, max);
  if (key === "End") return min;
  return null;
}
