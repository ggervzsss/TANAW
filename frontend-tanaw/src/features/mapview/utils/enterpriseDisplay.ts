import type { MapEnterprise } from "@/shared/types";

export function displayTrend(trend: MapEnterprise["trend"]) {
  return trend ?? "Not available";
}
