import L from "leaflet";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { MapEnterprise } from "@/shared/types";
import { MAP_PIN_ICON_PATHS, createTooltipHtml, getMapPinState, mapPinColors, type MapPinState } from "../utils";

type MutableRef<T> = { current: T };

/**
 * Keeps one Leaflet marker per visible enterprise. Pins are coloured by monitoring state, and an
 * enterprise with more visitors than usual gets an amber outer ring.
 */
export function useEnterpriseMarkers({
  ariaLabelFor,
  busyEnterpriseIds,
  focusedEnterpriseId,
  mapRef,
  markersRef,
  onSelect,
  visibleEnterprises,
}: {
  ariaLabelFor: (enterprise: MapEnterprise) => string;
  busyEnterpriseIds: ReadonlySet<string>;
  focusedEnterpriseId: string | null;
  mapRef: MutableRef<L.Map | null>;
  markersRef: MutableRef<Record<string, L.Marker>>;
  onSelect: (enterprise: MapEnterprise) => void;
  visibleEnterprises: MapEnterprise[];
}) {
  const previous = useRef(new Map<string, { enterprise: MapEnterprise; busy: boolean }>());
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
      const state = getMapPinState(enterprise);
      const busy = state === "busy" || (state === "normal" && busyEnterpriseIds.has(enterprise.id));
      const before = previous.current.get(enterprise.id);
      const statusChanged = Boolean(before && getMapPinState(before.enterprise) !== state);
      const makeIcon = () =>
        L.divIcon({
          className: `tanaw-map-pin${statusChanged ? " is-status-changing" : ""}`,
          iconAnchor: [25, 49],
          iconSize: [50, 54],
          popupAnchor: [0, -53],
          tooltipAnchor: [0, -53],
          html: createEnterpriseMarkerHtml(state, mapPinColors[state], busy),
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
          if (current) onSelectRef.current(current.enterprise);
        });
        // Pins are focusable buttons, so Enter and Space select them like a click.
        marker.getElement()?.addEventListener("keydown", (keyEvent) => {
          if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          const current = previous.current.get(enterprise.id);
          if (current) onSelectRef.current(current.enterprise);
        });
        markersRef.current[enterprise.id] = marker;
      } else {
        if (before?.enterprise.lat !== enterprise.lat || before?.enterprise.lng !== enterprise.lng) marker.setLatLng([enterprise.lat, enterprise.lng]);
        if (statusChanged || before?.busy !== busy) marker.setIcon(makeIcon());
        if (marker.getTooltip()?.getContent() !== tooltip) marker.setTooltipContent(tooltip);
      }
      marker.getElement()?.setAttribute("aria-label", ariaLabelFor(enterprise));
      marker.getElement()?.setAttribute("data-pin-state", state);
      previous.current.set(enterprise.id, { enterprise, busy });
    });
  }, [ariaLabelFor, busyEnterpriseIds, mapRef, markersRef, visibleEnterprises]);

  useEffect(() => {
    Object.entries(markersRef.current).forEach(([enterpriseId, marker]) => {
      const isSelected = enterpriseId === focusedEnterpriseId;
      const element = marker.getElement();
      element?.classList.toggle("is-selected", isSelected);
      if (isSelected) marker.closeTooltip();
      marker.setZIndexOffset(isSelected ? 1200 : 0);
    });
  }, [busyEnterpriseIds, focusedEnterpriseId, markersRef, visibleEnterprises]);
}

function createEnterpriseMarkerHtml(state: MapPinState, color: string, busy: boolean) {
  return `<span class="tanaw-enterprise-marker${busy ? " is-busy" : ""}" data-tone="${state}" style="--tanaw-marker-color:${color};">
    <span class="tanaw-enterprise-marker__selection" aria-hidden="true"></span>
    <span class="tanaw-enterprise-marker__halo" aria-hidden="true"></span>
    <span class="tanaw-enterprise-marker__body" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="${MAP_PIN_ICON_PATHS[state]}" />
      </svg>
    </span>
    <span class="tanaw-enterprise-marker__tip" aria-hidden="true"></span>
    <span class="tanaw-enterprise-marker__update" aria-hidden="true"></span>
  </span>`;
}
