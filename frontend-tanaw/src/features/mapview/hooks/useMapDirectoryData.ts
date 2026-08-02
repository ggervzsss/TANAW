import { useMemo } from "react";
import type { AccountSummary } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import { getBarangayLabel, getEnterprisesByBarangay, getFeatureValue, isBoundaryPolygonFeature, isPointInsideSanPedro, normalizeBarangayName, type GeoJsonFeatureCollection } from "../utils";

export function useMapDirectoryData({
  boundary,
  enterpriseAccounts,
  rawMapEnterprises,
  selectedBarangayName,
  selectedEnterpriseId,
}: {
  boundary: GeoJsonFeatureCollection | null;
  enterpriseAccounts: AccountSummary[];
  rawMapEnterprises: MapEnterprise[];
  selectedBarangayName: string | null;
  selectedEnterpriseId: string | null;
}) {
  const mapEnterprises = useMemo(() => rawMapEnterprises.filter((enterprise) => isPointInsideSanPedro(boundary, enterprise.lat, enterprise.lng)), [boundary, rawMapEnterprises]);
  const unpinnedEnterprises = useMemo(
    () => enterpriseAccounts.filter((enterprise) => enterprise.latitude === null || enterprise.longitude === null || !isPointInsideSanPedro(boundary, enterprise.latitude, enterprise.longitude)),
    [boundary, enterpriseAccounts],
  );
  const boundaryFeatureCount = useMemo(() => boundary?.features.filter(isBoundaryPolygonFeature).length ?? 0, [boundary]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const enterprise of mapEnterprises) {
      const key = normalizeBarangayName(enterprise.barangay);
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  }, [mapEnterprises]);
  const items = useMemo(
    () =>
      (boundary?.features ?? [])
        .filter(isBoundaryPolygonFeature)
        .map((feature) => {
          const label = getBarangayLabel(feature);
          return {
            feature,
            label,
            key: normalizeBarangayName(label),
            subtitle: getFeatureValue(feature, ["official_barangay", "name"]),
            enterpriseCount: counts.get(normalizeBarangayName(label)) ?? 0,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [boundary, counts],
  );
  const barangayDropdownOptions = useMemo(
    () => [
      { value: "", label: "All Barangays", meta: String(enterpriseAccounts.length) },
      ...items.map((item) => ({ value: item.label, label: `Barangay ${item.label}`, meta: String(item.enterpriseCount), searchText: item.subtitle })),
    ],
    [enterpriseAccounts.length, items],
  );
  const selectedBarangayEnterprises = useMemo(() => (selectedBarangayName ? getEnterprisesByBarangay(mapEnterprises, selectedBarangayName) : []), [mapEnterprises, selectedBarangayName]);
  const selectedBarangayUnpinnedEnterprises = useMemo(
    () => (selectedBarangayName ? unpinnedEnterprises.filter((enterprise) => normalizeBarangayName(enterprise.barangay ?? "Unassigned") === normalizeBarangayName(selectedBarangayName)) : []),
    [selectedBarangayName, unpinnedEnterprises],
  );
  return {
    barangayDropdownOptions,
    boundaryFeatureCount,
    mapEnterprises,
    selectedBarangayEnterprises,
    selectedBarangayUnpinnedEnterprises,
    selectedEnterprise: selectedEnterpriseId === null ? null : (mapEnterprises.find((enterprise) => enterprise.id === selectedEnterpriseId) ?? null),
    unpinnedEnterprises,
    visibleEnterprises: selectedBarangayName ? selectedBarangayEnterprises : mapEnterprises,
  };
}
