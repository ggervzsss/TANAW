import L from "leaflet";
import { useEffect } from "react";
import type { MapEnterprise } from "@/shared/types";
import { createPopupHtml, createTooltipHtml, getMonitoringStatusColor, getOccupancyRingColor, type LeafletMapTheme } from "../utils";

type MutableRef<T> = { current: T };

export function useEnterpriseMarkers({
  mapRef,
  markersRef,
  mapTheme,
  onSelect,
  selectedEnterpriseId,
  visibleEnterprises,
}: {
  mapRef: MutableRef<L.Map | null>;
  markersRef: MutableRef<Record<string, L.Marker>>;
  mapTheme: LeafletMapTheme;
  onSelect: (enterprise: MapEnterprise) => void;
  selectedEnterpriseId: string | null;
  visibleEnterprises: MapEnterprise[];
}) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    visibleEnterprises.forEach((enterprise) => {
      const color = getMonitoringStatusColor(enterprise.monitoringStatus);
      const occupancyRingColor = getOccupancyRingColor(enterprise.occupancyStatus);
      const markerOutline = mapTheme === "dark" ? "#dbeafe" : "#ffffff";
      const markerShadow = mapTheme === "dark" ? "0 0 0 2px rgba(8,17,31,.72),0 8px 20px rgba(0,0,0,.58)" : "0 2px 8px rgba(0,0,0,.45)";
      const marker = L.marker([enterprise.lat, enterprise.lng], {
        icon: L.divIcon({
          className: enterprise.occupancyStatus === "High Occupancy" ? "tanaw-map-pin animate-pulse" : "tanaw-map-pin",
          iconAnchor: [12, 12],
          popupAnchor: [0, -10],
          html: `<span style="background-color:${color};width:20px;height:20px;display:block;border-radius:50%;border:3px solid ${markerOutline};box-shadow:0 0 0 4px ${occupancyRingColor},${markerShadow};"></span>`,
        }),
      }).addTo(map);
      marker.bindTooltip(createTooltipHtml(enterprise, color), { direction: "top", offset: [0, -10], opacity: 0.95 });
      marker.bindPopup(createPopupHtml(enterprise, color), { closeButton: false });
      marker.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        onSelect(enterprise);
      });
      markersRef.current[enterprise.id] = marker;
    });
  }, [mapRef, mapTheme, markersRef, onSelect, visibleEnterprises]);

  useEffect(() => {
    if (!selectedEnterpriseId || !mapRef.current || !markersRef.current[selectedEnterpriseId]) return;
    markersRef.current[selectedEnterpriseId].openPopup();
  }, [mapRef, markersRef, selectedEnterpriseId, visibleEnterprises]);
}
