import type { CameraConfig } from "../types/camera";
import { tripwirePathLength, tripwirePathsOverlap } from "./tripwire-path";

export function getValidationWarnings(config?: CameraConfig) {
  const warnings: string[] = [];
  if (!config) return warnings;

  if (config.tripwires) {
    if (tripwirePathLength(config.tripwires.entry) < 10 || tripwirePathLength(config.tripwires.exit) < 10) {
      warnings.push("Warning: Tripwire path is short. Longer paths are more reliable for crossing detection.");
    }
    if (tripwirePathsOverlap(config.tripwires.entry, config.tripwires.exit, 3)) {
      warnings.push("Warning: Entry and exit tripwire paths overlap. Separate them so direction can be detected reliably.");
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
