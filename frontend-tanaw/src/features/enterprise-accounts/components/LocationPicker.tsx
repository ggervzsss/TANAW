import L, { type GeoJSONOptions, type Layer } from "leaflet";
import { MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBoundaryPopupHtml,
  createBoundaryTooltipHtml,
  fitMapToSanPedroBounds,
  getBarangayPointResolution,
  getBarangayLabel,
  getGeoJsonColor,
  isBoundaryPolygonFeature,
  isPointInsideSanPedro,
  normalizeGeoJson,
  sanPedroFallbackCenter,
  sanPedroRelaxedFallbackBounds,
  SAN_PEDRO_BARANGAYS_URL,
  type BarangayPointResolution,
  type GeoJsonFeatureCollection,
} from "@/features/mapview/utils";
import type { LocationDraft } from "../types";

const defaultMapContainerId = "enterprise-location-picker";

type LocationPickerProps = {
  location: LocationDraft | null;
  isResolvingAddress?: boolean;
  mapId?: string;
  mapHeightClassName?: string;
  resizeSignal?: string | number | boolean;
  showBoundaries?: boolean;
  onBoundaryDetection?: (location: LocationDraft, barangayDetection: BarangayPointResolution) => void;
  onChange: (location: LocationDraft, barangayDetection?: BarangayPointResolution) => void;
  onReject?: (message: string) => void;
};

export function LocationPicker({
  location,
  isResolvingAddress = false,
  mapId = defaultMapContainerId,
  mapHeightClassName = "h-72",
  resizeSignal,
  showBoundaries = true,
  onBoundaryDetection,
  onChange,
  onReject,
}: LocationPickerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const latestLocationRef = useRef<LocationDraft | null>(location);
  const boundaryRef = useRef<GeoJsonFeatureCollection | null>(null);
  const lastBoundaryDetectionKeyRef = useRef("");
  const selectLocationRef = useRef<(latitude: number, longitude: number, source: LocationDraft["source"]) => void>(() => {});
  const [boundary, setBoundary] = useState<GeoJsonFeatureCollection | null>(null);
  const [isBoundaryLoading, setIsBoundaryLoading] = useState(true);
  const [isBoundaryError, setIsBoundaryError] = useState(false);

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
    (latitude: number, longitude: number, source: LocationDraft["source"]) => {
      const loadedBoundary = boundaryRef.current;

      if (!isPointInsideSanPedro(loadedBoundary, latitude, longitude)) {
        restoreMarkerAfterRejectedMove();
        onReject?.("Choose a location inside San Pedro, Laguna.");
        return;
      }

      const latestLocation = latestLocationRef.current;
      const barangayDetection = getBarangayPointResolution(loadedBoundary, latitude, longitude);
      onChange(
        {
          ...(latestLocation ?? {}),
          latitude,
          longitude,
          source,
        },
        barangayDetection,
      );
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

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.on("click", (event) => {
      selectLocationRef.current(event.latlng.lat, event.latlng.lng, markerRef.current ? "adjusted" : "manual");
    });

    const timers = [0, 160, 320].map((delay) =>
      window.setTimeout(() => {
        map.invalidateSize({ pan: false });
      }, delay),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
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
      return {
        color: "#2a3063",
        fillColor: getGeoJsonColor(name),
        fillOpacity: 0.34,
        opacity: 0.78,
        pane: "locationBoundaryPane",
        weight: 1,
        className: "tanaw-location-boundary-path outline-none",
      };
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
        selectLocationRef.current(latLng.lat, latLng.lng, markerRef.current ? "adjusted" : "manual");
      });
    };

    boundaryLayerRef.current = L.geoJSON(boundary, {
      style: boundaryStyle,
      onEachFeature,
    }).addTo(map);

    fitMapToSanPedroBounds(map, boundaryLayerRef.current);
  }, [boundary, showBoundaries]);

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
        const latestLocation = latestLocationRef.current;
        if (!position) return;
        selectLocationRef.current(position.lat, position.lng, latestLocation?.source === "manual" ? "manual" : "adjusted");
      });
    } else {
      markerRef.current.setLatLng(nextLatLng);
    }

    map.flyTo(nextLatLng, Math.max(map.getZoom(), 15), { animate: true, duration: 0.55 });
  }, [location]);

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-slate-100 shadow-sm ring-1 ring-white">
      <div id={mapId} className={`${mapHeightClassName} w-full`} />
      <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
        <MapPin size={14} className="text-tgreen-dark shrink-0" />
        <span className="truncate">{getFooterText(location, isResolvingAddress, isBoundaryLoading, isBoundaryError, showBoundaries)}</span>
      </div>
    </div>
  );
}

function getFooterText(location: LocationDraft | null, isResolvingAddress: boolean, isBoundaryLoading: boolean, isBoundaryError: boolean, showBoundaries: boolean) {
  if (isResolvingAddress) return "Resolving the selected location address...";
  if (location?.displayAddress) return location.displayAddress;
  if (isBoundaryLoading) return "Loading San Pedro barangay boundaries...";
  if (isBoundaryError) return "Boundary layer unavailable. Keep the marker within San Pedro city limits.";
  if (!showBoundaries) return "Barangay boundaries hidden. Marker validation still uses San Pedro limits.";
  return "Click inside San Pedro to place a marker, or drag the marker to correct it.";
}
