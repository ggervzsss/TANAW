import L, { type GeoJSONOptions, type Layer } from "leaflet";
import { MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBoundaryPopupHtml,
  createBoundaryTooltipHtml,
  fitMapToSanPedroBounds,
  getBaseBoundaryStyle,
  getBarangayPointResolution,
  getBarangayLabel,
  getCurrentLeafletMapTheme,
  isBoundaryPolygonFeature,
  isPointInsideSanPedro,
  mountLeafletThemeLayer,
  normalizeGeoJson,
  sanPedroFallbackCenter,
  sanPedroRelaxedFallbackBounds,
  SAN_PEDRO_BARANGAYS_URL,
  type BarangayPointResolution,
  type GeoJsonFeatureCollection,
  type LeafletMapTheme,
} from "@/features/mapview/utils";
import type { EnterpriseLocationSuggestion, LocationDraft } from "../types";
import { LocationSearch } from "./LocationSearch";

const defaultMapContainerId = "enterprise-location-picker";

type LocationPickerProps = {
  location: LocationDraft | null;
  mapId?: string;
  mapHeightClassName?: string;
  resizeSignal?: string | number | boolean;
  showBoundaries?: boolean;
  onBoundaryDetection?: (location: LocationDraft, barangayDetection: BarangayPointResolution) => void;
  onChange: (location: LocationDraft, barangayDetection?: BarangayPointResolution) => void;
  onReject?: (message: string) => void;
  onSearchResultSelect?: (suggestion: EnterpriseLocationSuggestion) => void;
};

export function LocationPicker({
  location,
  mapId = defaultMapContainerId,
  mapHeightClassName = "h-72",
  resizeSignal,
  showBoundaries = true,
  onBoundaryDetection,
  onChange,
  onReject,
  onSearchResultSelect,
}: LocationPickerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const latestLocationRef = useRef<LocationDraft | null>(location);
  const boundaryRef = useRef<GeoJsonFeatureCollection | null>(null);
  const lastBoundaryDetectionKeyRef = useRef("");
  const selectLocationRef = useRef<(latitude: number, longitude: number) => boolean>(() => false);
  const [boundary, setBoundary] = useState<GeoJsonFeatureCollection | null>(null);
  const [isBoundaryLoading, setIsBoundaryLoading] = useState(true);
  const [isBoundaryError, setIsBoundaryError] = useState(false);
  const [mapTheme, setMapTheme] = useState<LeafletMapTheme>(() => getCurrentLeafletMapTheme());

  useEffect(() => {
    latestLocationRef.current = location;
  }, [location]);

  useEffect(() => {
    boundaryRef.current = boundary;
  }, [boundary]);

  useEffect(() => {
    if (!boundary || !location) return;

    const detectionKey = `${location.latitude.toFixed(6)}:${location.longitude.toFixed(6)}:${boundary.features.length}`;
    if (lastBoundaryDetectionKeyRef.current === detectionKey) return;
    lastBoundaryDetectionKeyRef.current = detectionKey;

    if (!isPointInsideSanPedro(boundary, location.latitude, location.longitude)) {
      onReject?.("Choose a location inside San Pedro, Laguna.");
      return;
    }

    onBoundaryDetection?.(location, getBarangayPointResolution(boundary, location.latitude, location.longitude));
  }, [boundary, location, onBoundaryDetection, onReject]);

  const restoreMarkerAfterRejectedMove = useCallback(() => {
    const latestLocation = latestLocationRef.current;
    if (!markerRef.current || !latestLocation) return;
    markerRef.current.setLatLng([latestLocation.latitude, latestLocation.longitude]);
  }, []);

  const selectLocation = useCallback(
    (latitude: number, longitude: number) => {
      const loadedBoundary = boundaryRef.current;

      if (!isPointInsideSanPedro(loadedBoundary, latitude, longitude)) {
        restoreMarkerAfterRejectedMove();
        onReject?.("Choose a location inside San Pedro, Laguna.");
        return false;
      }

      const barangayDetection = getBarangayPointResolution(loadedBoundary, latitude, longitude);
      onChange(
        {
          latitude,
          longitude,
        },
        barangayDetection,
      );
      return true;
    },
    [onChange, onReject, restoreMarkerAfterRejectedMove],
  );

  useEffect(() => {
    selectLocationRef.current = selectLocation;
  }, [selectLocation]);

  useEffect(() => {
    let isMounted = true;

    fetch(SAN_PEDRO_BARANGAYS_URL)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load San Pedro barangay boundaries.");
        return response.json() as Promise<GeoJsonFeatureCollection>;
      })
      .then((payload) => {
        if (!isMounted) return;
        setBoundary(normalizeGeoJson(payload));
        setIsBoundaryError(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setBoundary(null);
        setIsBoundaryError(true);
      })
      .finally(() => {
        if (isMounted) setIsBoundaryLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) return undefined;

    const map = L.map(mapId, {
      center: sanPedroFallbackCenter,
      zoom: 13,
      maxBounds: sanPedroRelaxedFallbackBounds,
      maxBoundsViscosity: 0.45,
      minZoom: 11.2,
      maxZoom: 18,
      zoomControl: false,
    });
    mapRef.current = map;
    map.createPane("locationBoundaryPane");
    const boundaryPane = map.getPane("locationBoundaryPane");
    if (boundaryPane) {
      boundaryPane.style.zIndex = "410";
    }

    const cleanupTileLayer = mountLeafletThemeLayer(map, setMapTheme);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.on("click", (event) => {
      selectLocationRef.current(event.latlng.lat, event.latlng.lng);
    });

    const timers = [0, 160, 320].map((delay) =>
      window.setTimeout(() => {
        map.invalidateSize({ pan: false });
      }, delay),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      cleanupTileLayer();
      markerRef.current?.remove();
      markerRef.current = null;
      boundaryLayerRef.current?.remove();
      boundaryLayerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [mapId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const timers = [0, 180, 360].map((delay) =>
      window.setTimeout(() => {
        map.invalidateSize({ pan: false });
      }, delay),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [resizeSignal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary) return;

    boundaryLayerRef.current?.remove();
    boundaryLayerRef.current = null;

    if (!showBoundaries) {
      return;
    }

    const boundaryStyle: GeoJSONOptions["style"] = (geoFeature) => {
      const name = getBarangayLabel(geoFeature);
      return getBaseBoundaryStyle(name, mapTheme, "locationBoundaryPane", "location");
    };

    const onEachFeature: GeoJSONOptions["onEachFeature"] = (geoFeature, layer: Layer) => {
      if (!isBoundaryPolygonFeature(geoFeature)) return;

      const name = getBarangayLabel(geoFeature);
      layer.bindTooltip(createBoundaryTooltipHtml(name), {
        sticky: true,
        direction: "auto",
        opacity: 0.95,
      });
      layer.bindPopup(createBoundaryPopupHtml(geoFeature), {
        closeButton: false,
      });
      layer.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        const latLng = event.latlng;
        selectLocationRef.current(latLng.lat, latLng.lng);
      });
    };

    boundaryLayerRef.current = L.geoJSON(boundary, {
      style: boundaryStyle,
      onEachFeature,
    }).addTo(map);

    fitMapToSanPedroBounds(map, boundaryLayerRef.current);
  }, [boundary, mapTheme, showBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location) return;

    const nextLatLng: L.LatLngTuple = [location.latitude, location.longitude];
    if (!markerRef.current) {
      markerRef.current = L.marker(nextLatLng, {
        draggable: true,
        icon: L.divIcon({
          className: "tanaw-location-preview-pin",
          iconAnchor: [10, 10],
          html: `<span style="background:#065f46;width:22px;height:22px;display:block;border-radius:50%;border:4px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.35);"></span>`,
        }),
      }).addTo(map);

      markerRef.current.on("dragend", () => {
        const position = markerRef.current?.getLatLng();
        if (!position) return;
        selectLocationRef.current(position.lat, position.lng);
      });
    } else {
      markerRef.current.setLatLng(nextLatLng);
    }

    map.flyTo(nextLatLng, Math.max(map.getZoom(), 15), { animate: true, duration: 0.55 });
  }, [location]);

  return (
    // Open, not boxed: the search field, then the map as a soft-edged preview, then a line on how to pin.
    <div className="grid h-fit gap-3 self-start">
      <LocationSearch
        inputId={`${mapId}-search`}
        onSelect={(suggestion) => {
          if (selectLocation(suggestion.latitude, suggestion.longitude)) onSearchResultSelect?.(suggestion);
        }}
      />
      <div className="rounded-tanaw-lg overflow-hidden border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset)">
        <div id={mapId} className={`${mapHeightClassName} w-full`} />
      </div>
      <p className="flex items-center gap-2 text-[13px] text-(--tanaw-text-secondary)">
        <MapPin size={14} aria-hidden="true" className="shrink-0 text-(--tanaw-accent-ink)" />
        <span className="truncate">{getFooterText(isBoundaryLoading, isBoundaryError, showBoundaries)}</span>
      </p>
    </div>
  );
}

function getFooterText(isBoundaryLoading: boolean, isBoundaryError: boolean, showBoundaries: boolean) {
  if (isBoundaryLoading) return "Loading San Pedro barangay boundaries...";
  if (isBoundaryError) return "Boundary layer unavailable. Keep the marker within San Pedro city limits.";
  if (!showBoundaries) return "Barangay boundaries hidden. Marker validation still uses San Pedro limits.";
  return "Click inside San Pedro to place a marker, or drag the marker to correct it.";
}
