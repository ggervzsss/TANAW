const MIN_CONTENT_ZOOM = 0.4;
const MAX_CONTENT_ZOOM = 1;
const ZOOM_PRECISION = 10_000;

export type DisplayScaleSubscription = (listener: () => void) => () => void;

export type DisplayScaleControllerOptions = {
  applyZoomFactor: (zoomFactor: number) => void;
  getAppliedZoomFactor?: () => number;
  getScaleFactor: () => number;
  subscribeToDisplayChanges: DisplayScaleSubscription;
  subscribeToWindowChanges: DisplayScaleSubscription;
};

export type DisplayScaleController = {
  dispose: () => void;
  refresh: () => number;
  start: () => number;
};

/**
 * Electron reports window bounds in display-independent pixels. On heavily
 * scaled Windows displays that can leave the renderer with a very small CSS
 * viewport, so normalize the Chromium content zoom against the active display.
 *
 * The 0.4 floor fully compensates through 250% and leaves 300% displays at
 * 120% of baseline physical density, avoiding microscopic high-DPI text.
 */
export function calculateDisplayZoomFactor(scaleFactor: number) {
  const safeScaleFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const normalizedZoom = 1 / safeScaleFactor;
  const clampedZoom = Math.min(MAX_CONTENT_ZOOM, Math.max(MIN_CONTENT_ZOOM, normalizedZoom));
  return Math.round(clampedZoom * ZOOM_PRECISION) / ZOOM_PRECISION;
}

export function createDisplayScaleController(options: DisplayScaleControllerOptions): DisplayScaleController {
  let lastAppliedZoom: number | null = null;
  let unsubscribeFromDisplayChanges: (() => void) | null = null;
  let unsubscribeFromWindowChanges: (() => void) | null = null;

  const refresh = () => {
    const nextZoom = calculateDisplayZoomFactor(options.getScaleFactor());
    const appliedZoom = options.getAppliedZoomFactor?.();
    const appliedZoomMatches = appliedZoom === undefined || (Number.isFinite(appliedZoom) && Math.abs(appliedZoom - nextZoom) < 0.0001);
    if (nextZoom !== lastAppliedZoom || !appliedZoomMatches) {
      options.applyZoomFactor(nextZoom);
      lastAppliedZoom = nextZoom;
    }
    return nextZoom;
  };

  const dispose = () => {
    unsubscribeFromDisplayChanges?.();
    unsubscribeFromWindowChanges?.();
    unsubscribeFromDisplayChanges = null;
    unsubscribeFromWindowChanges = null;
  };

  const start = () => {
    const initialZoom = refresh();
    if (!unsubscribeFromDisplayChanges) {
      unsubscribeFromDisplayChanges = options.subscribeToDisplayChanges(refresh);
    }
    if (!unsubscribeFromWindowChanges) {
      unsubscribeFromWindowChanges = options.subscribeToWindowChanges(refresh);
    }
    return initialZoom;
  };

  return { dispose, refresh, start };
}
