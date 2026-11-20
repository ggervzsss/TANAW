import L from "leaflet";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { MapEnterprise } from "@/shared/types";
import { createTooltipHtml, getMonitoringStatusLabel, getMonitoringStatusPresentation, getOccupancyRingColor } from "../utils";

type MutableRef<T> = { current: T };

export function useEnterpriseMarkers({
  focusedEnterpriseId,
  hoveredEnterpriseId,
  mapRef,
  markersRef,
  onSelect,
  visibleEnterprises,
}: {
  focusedEnterpriseId: string | null;
  hoveredEnterpriseId: string | null;
  mapRef: MutableRef<L.Map | null>;
  markersRef: MutableRef<Record<string, L.Marker>>;
  onSelect: (enterprise: MapEnterprise) => void;
  visibleEnterprises: MapEnterprise[];
}) {
  const previous = useRef(new Map<string, MapEnterprise>());
  const onSelectRef = useRef(onSelect);
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibleIds = new Set(visibleEnterprises.map(({ id }) => id));
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      if (visibleIds.has(id)) return;
      marker.remove();
      delete markersRef.current[id];
      previous.current.delete(id);
    });

    visibleEnterprises.forEach((enterprise) => {
      const statusPresentation = getMonitoringStatusPresentation(enterprise.monitoringStatus);
      const occupancyRingColor = getOccupancyRingColor(enterprise.occupancyStatus);
      const before = previous.current.get(enterprise.id);
      const statusChanged = Boolean(before && before.monitoringStatus !== enterprise.monitoringStatus);
      const makeIcon = () =>
        L.divIcon({
          className: `tanaw-map-pin${statusChanged ? " is-status-changing" : ""}`,
          iconAnchor: [25, 49],
          iconSize: [50, 54],
          popupAnchor: [0, -53],
          tooltipAnchor: [0, -53],
          html: createEnterpriseMarkerHtml(statusPresentation.tone, statusPresentation.color, occupancyRingColor, occupancyRingColor !== "transparent"),
        });
      const tooltip = createTooltipHtml(enterprise);
      let marker = markersRef.current[enterprise.id];

      if (!marker) {
        marker = L.marker([enterprise.lat, enterprise.lng], { icon: makeIcon(), autoPanOnFocus: false, riseOnHover: true }).addTo(map);
        marker.bindTooltip(tooltip, { direction: "top", opacity: 1, className: "tanaw-enterprise-tooltip" });
        marker.on("tooltipopen", () => {
          if (marker.getElement()?.classList.contains("is-selected")) marker.closeTooltip();
        });
        marker.on("click", (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          const current = previous.current.get(enterprise.id);
          if (current) onSelectRef.current(current);
        });
        markersRef.current[enterprise.id] = marker;
      } else {
        if (before?.lat !== enterprise.lat || before?.lng !== enterprise.lng) marker.setLatLng([enterprise.lat, enterprise.lng]);
        if (statusChanged || before?.occupancyStatus !== enterprise.occupancyStatus) marker.setIcon(makeIcon());
        if (marker.getTooltip()?.getContent() !== tooltip) marker.setTooltipContent(tooltip);
      }
      marker.getElement()?.setAttribute("aria-label", [enterprise.name, enterprise.barangay, getMonitoringStatusLabel(enterprise.monitoringStatus)].filter(Boolean).join(", "));
      previous.current.set(enterprise.id, enterprise);
    });
  }, [mapRef, markersRef, visibleEnterprises]);

  useEffect(() => {
    Object.entries(markersRef.current).forEach(([enterpriseId, marker]) => {
      const isHovered = enterpriseId === hoveredEnterpriseId;
      const isSelected = enterpriseId === focusedEnterpriseId;
      const element = marker.getElement();
      element?.classList.toggle("is-directory-hovered", isHovered);
      element?.classList.toggle("is-selected", isSelected);
      if (isSelected) marker.closeTooltip();
      marker.setZIndexOffset(isHovered ? 2000 : isSelected ? 1200 : 0);
    });
  }, [focusedEnterpriseId, hoveredEnterpriseId, markersRef, visibleEnterprises]);

}

function createEnterpriseMarkerHtml(tone: string, statusColor: string, occupancyRingColor: string, hasOccupancyAlert: boolean) {
  return `<span class="tanaw-enterprise-marker${hasOccupancyAlert ? " has-occupancy-alert" : ""}" data-tone="${tone}" style="--tanaw-marker-color:${statusColor};--tanaw-marker-alert:${occupancyRingColor};">
    <span class="tanaw-enterprise-marker__selection" aria-hidden="true"></span>
    <span class="tanaw-enterprise-marker__halo" aria-hidden="true"></span>
    <span class="tanaw-enterprise-marker__body" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M5.5 20V7.7a1 1 0 0 1 .66-.94l5.5-2.02a1 1 0 0 1 1.34.94V20M13 9h5a1 1 0 0 1 1 1v10M3.5 20h17M8.5 9.5h1M8.5 12.5h1M8.5 15.5h1M15.5 12.5h1M15.5 15.5h1" />
      </svg>
    </span>
    <span class="tanaw-enterprise-marker__tip" aria-hidden="true"></span>
    <span class="tanaw-enterprise-marker__update" aria-hidden="true"></span>
  </span>`;
}
