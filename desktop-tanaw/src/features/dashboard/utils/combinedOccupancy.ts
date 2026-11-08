import type { MlAreaState } from "../../camera/services/ml-service";

// Configured areas represent separate, non-overlapping parts of the establishment.
export function combineLiveOccupancy(entranceOccupancy: number | null, areas: Array<MlAreaState | null | undefined>): number | null {
  if (entranceOccupancy === null) return null;
  let total = entranceOccupancy;
  for (const area of areas) {
    // Unknown observations must not silently contribute zero to the total.
    if (!area?.available || area.presence === null) return null;
    total += area.presence;
  }
  return total;
}
