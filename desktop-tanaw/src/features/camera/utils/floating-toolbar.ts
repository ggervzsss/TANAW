export type FloatingToolbarPosition = { x: number; y: number };
export type FloatingToolbarSize = { height: number; width: number };

export function clampFloatingToolbarPosition(position: FloatingToolbarPosition, container: FloatingToolbarSize, toolbar: FloatingToolbarSize, padding = 8): FloatingToolbarPosition {
  const maxX = Math.max(padding, container.width - toolbar.width - padding);
  const maxY = Math.max(padding, container.height - toolbar.height - padding);

  return {
    x: Math.min(maxX, Math.max(padding, position.x)),
    y: Math.min(maxY, Math.max(padding, position.y)),
  };
}

export function hasExceededDragThreshold(start: FloatingToolbarPosition, current: FloatingToolbarPosition, threshold: number) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
