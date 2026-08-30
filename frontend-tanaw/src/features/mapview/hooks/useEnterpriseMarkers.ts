import L from "leaflet";
import { useEffect, useRef } from "react";
import type { MapEnterprise } from "@/shared/types";
import { createPopupHtml, createTooltipHtml, getMonitoringStatusPresentation, getOccupancyRingColor, type LeafletMapTheme } from "../utils";

type MutableRef<T> = { current: T };

export function useEnterpriseMarkers({
  hoveredEnterpriseId,
  mapRef,
  markersRef,
  mapTheme,
  onSelect,
  selectedEnterpriseId,
  visibleEnterprises,
}: {
  hoveredEnterpriseId: string | null;
  mapRef: MutableRef<L.Map | null>;
  markersRef: MutableRef<Record<string, L.Marker>>;
  mapTheme: LeafletMapTheme;
  onSelect: (enterprise: MapEnterprise) => void;
  selectedEnterpriseId: string | null;
  visibleEnterprises: MapEnterprise[];
}) {
  const previousStatusesRef = useRef<Record<string, MapEnterprise["monitoringStatus"]>>({});

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    visibleEnterprises.forEach((enterprise) => {
      const statusPresentation = getMonitoringStatusPresentation(enterprise.monitoringStatus);
      const color = statusPresentation.color;
      const occupancyRingColor = getOccupancyRingColor(enterprise.occupancyStatus);
      const previousStatus = previousStatusesRef.current[enterprise.id];
      const didStatusChange = previousStatus !== undefined && previousStatus !== enterprise.monitoringStatus;
      const marker = L.marker([enterprise.lat, enterprise.lng], {
        icon: L.divIcon({
          className: `tanaw-map-pin${didStatusChange ? " is-status-changing" : ""}`,
          iconAnchor: [18, 38],
          iconSize: [36, 42],
          popupAnchor: [0, -34],
          html: createEnterpriseMarkerHtml(statusPresentation.tone, color, occupancyRingColor, enterprise.occupancyStatus !== "Normal"),
        }),
        alt: `${enterprise.name}, ${enterprise.monitoringStatus}`,
        riseOnHover: true,
        title: enterprise.name,
      }).addTo(map);
      marker.bindTooltip(createTooltipHtml(enterprise, color), { direction: "top", offset: [0, -32], opacity: 0.95 });
      marker.bindPopup(createPopupHtml(enterprise, color), { closeButton: false });
      marker.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        onSelect(enterprise);
      });
      markersRef.current[enterprise.id] = marker;
      previousStatusesRef.current[enterprise.id] = enterprise.monitoringStatus;
    });

    const visibleIds = new Set(visibleEnterprises.map((enterprise) => enterprise.id));
    Object.keys(previousStatusesRef.current).forEach((enterpriseId) => {
      if (!visibleIds.has(enterpriseId)) delete previousStatusesRef.current[enterpriseId];
    });
  }, [mapRef, mapTheme, markersRef, onSelect, visibleEnterprises]);

  useEffect(() => {
    Object.entries(markersRef.current).forEach(([enterpriseId, marker]) => {
      const isHovered = enterpriseId === hoveredEnterpriseId;
      const isSelected = enterpriseId === selectedEnterpriseId;
      const element = marker.getElement();
      element?.classList.toggle("is-directory-hovered", isHovered);
      element?.classList.toggle("is-selected", isSelected);
      marker.setZIndexOffset(isHovered ? 2000 : isSelected ? 1200 : 0);
    });
  }, [hoveredEnterpriseId, markersRef, selectedEnterpriseId, visibleEnterprises]);

  useEffect(() => {
    if (!selectedEnterpriseId || !mapRef.current || !markersRef.current[selectedEnterpriseId]) return;
    markersRef.current[selectedEnterpriseId].openPopup();
  }, [mapRef, markersRef, selectedEnterpriseId, visibleEnterprises]);
}

function createEnterpriseMarkerHtml(tone: string, statusColor: string, occupancyRingColor: string, hasOccupancyAlert: boolean) {
  return `<span class="tanaw-enterprise-marker${hasOccupancyAlert ? " has-occupancy-alert" : ""}" data-tone="${tone}" style="--tanaw-marker-color:${statusColor};--tanaw-marker-alert:${occupancyRingColor};">
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
