import type { CameraConfig } from "../types/camera";

export function getValidationWarnings(config?: CameraConfig) {
  const warnings: string[] = [];
  if (!config) return warnings;

  if (config.tripwires) {
    if (lineLength(config.tripwires.entry) < 10 || lineLength(config.tripwires.exit) < 10) {
      warnings.push("Warning: Tripwire line is short. Longer lines are more reliable for crossing detection.");
    }
    if (linesOverlap(config.tripwires.entry, config.tripwires.exit, 3)) {
      warnings.push("Warning: Entry and exit tripwire lines overlap. Separate them so direction can be detected reliably.");
    }
  } else if (config.tripwire < 20 || config.tripwire > 80) {
    warnings.push("Warning: Tripwire placed too close to the frame edge. Head occlusion may occur, reducing accuracy.");
  }

  if (config.roi.left + config.roi.width > 100 || config.roi.top + config.roi.height > 100) {
    warnings.push("Warning: Region of Interest (ROI) extends outside the camera frame.");
  }

  if (config.roi.width < 40 || config.roi.height < 40) {
    warnings.push("Warning: Region of Interest (ROI) is small. Ensure it fully covers the primary entry/exit pathway.");
  }

  return warnings;
}

function lineLength(line: CameraConfig["tripwires"]["entry"]) {
  const deltaX = line.end.x - line.start.x;
  const deltaY = line.end.y - line.start.y;
  return Math.hypot(deltaX, deltaY);
}

function linesOverlap(first: CameraConfig["tripwires"]["entry"], second: CameraConfig["tripwires"]["entry"], tolerance: number) {
  const sameDirection = pointDistance(first.start, second.start) < tolerance && pointDistance(first.end, second.end) < tolerance;
  const reverseDirection = pointDistance(first.start, second.end) < tolerance && pointDistance(first.end, second.start) < tolerance;
  return sameDirection || reverseDirection;
}

function pointDistance(first: CameraConfig["tripwires"]["entry"]["start"], second: CameraConfig["tripwires"]["entry"]["start"]) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
