import L, { type GeoJSONOptions, type Layer } from "leaflet";
import { Activity, ArrowLeft, BarChart3, Building2, Map as MapIcon, MapPin, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { useOperationalMapEnterprises } from "@/shared/hooks/useOperationalSync";
import { SelectDropdown } from "@/shared/components/ui";
import { listEnterpriseAccounts, type AccountSummary } from "@/shared/services/accountManagement";
import type { MapEnterprise, VisitorInsightRange } from "@/shared/types";
import {
  createBoundaryPopupHtml,
  createBoundaryTooltipHtml,
  createPopupHtml,
  createTooltipHtml,
  fitMapToSanPedroBounds,
  getActiveBoundaryStyle,
  getBarangayLabel,
  getBaseBoundaryStyle,
  getCurrentLeafletMapTheme,
  getDimmedBoundaryStyle,
  getDarkStatusBadgeClass,
  getEnterpriseStatusColor,
  getEnterprisesByBarangay,
  getFeatureValue,
  getHoverBoundaryStyle,
  isBoundaryPolygonFeature,
  isPointInsideSanPedro,
  mountLeafletThemeLayer,
  normalizeBarangayName,
  normalizeGeoJson,
  sanPedroFallbackCenter,
  sanPedroRelaxedFallbackBounds,
  SAN_PEDRO_BARANGAYS_URL,
  type GeoJsonFeatureCollection,
  type LeafletMapTheme,
} from "../utils";
import { EnterpriseDetailsModal } from "./EnterpriseDetailsModal";
import { VisitorInsightsDrawer } from "./VisitorInsightsDrawer";

const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];
const EMPTY_MAP_ENTERPRISES: MapEnterprise[] = [];

export function AdminEnterpriseMap() {
  const mapContainerId = "admin-enterprise-map";
  const mapRef = useRef<L.Map | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const activeBoundaryRef = useRef<L.Path | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const selectedBarangayNameRef = useRef<string | null>(null);
  const hasInitialOverviewFitRef = useRef(false);

  const [boundary, setBoundary] = useState<GeoJsonFeatureCollection | null>(null);
  const [isBoundaryLoading, setIsBoundaryLoading] = useState(true);
  const [isBoundaryError, setIsBoundaryError] = useState(false);
  const [isDirectoryCollapsed, setIsDirectoryCollapsed] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [selectedBarangayName, setSelectedBarangayName] = useState<string | null>(null);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | null>(null);
  const [insightEnterpriseId, setInsightEnterpriseId] = useState<string | null>(null);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [insightRange, setInsightRange] = useState<VisitorInsightRange>("7d");
  const [mapTheme, setMapTheme] = useState<LeafletMapTheme>(() => getCurrentLeafletMapTheme());
  const token = useAuthStore((state) => state.token);
  const enterpriseAccountsQuery = useQuery({ queryKey: ["enterprise-accounts", token], queryFn: listEnterpriseAccounts, enabled: Boolean(token) });
  const mapEnterprisesQuery = useOperationalMapEnterprises();
  const enterpriseAccounts = enterpriseAccountsQuery.data ?? EMPTY_ENTERPRISE_ACCOUNTS;
  const rawMapEnterprises = mapEnterprisesQuery.data ?? EMPTY_MAP_ENTERPRISES;
  const mapEnterprises = useMemo(() => rawMapEnterprises.filter((enterprise) => isPointInsideSanPedro(boundary, enterprise.lat, enterprise.lng)), [boundary, rawMapEnterprises]);
  const unpinnedEnterprises = useMemo(() => enterpriseAccounts.filter((enterprise) => !hasUsableSanPedroCoordinates(boundary, enterprise)), [boundary, enterpriseAccounts]);
  const unpinnedEnterpriseCount = unpinnedEnterprises.length;

  const boundaryFeatureCount = useMemo(() => boundary?.features.filter(isBoundaryPolygonFeature).length ?? 0, [boundary]);

  const enterpriseCountsByBarangay = useMemo(() => {
    const counts = new Map<string, number>();

    mapEnterprises.forEach((enterprise) => {
      const key = normalizeBarangayName(enterprise.barangay);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return counts;
  }, [mapEnterprises]);

  const barangayDirectoryItems = useMemo(() => {
    return (boundary?.features ?? [])
      .filter(isBoundaryPolygonFeature)
      .map((featureItem) => {
        const label = getBarangayLabel(featureItem);
        const key = normalizeBarangayName(label);
        const enterpriseCount = enterpriseCountsByBarangay.get(key) ?? 0;

        return {
          feature: featureItem,
          label,
          key,
          subtitle: getFeatureValue(featureItem, ["official_barangay", "name"]),
          enterpriseCount,
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [boundary, enterpriseCountsByBarangay]);

  const barangayDropdownOptions = useMemo(
    () => [
      { value: "", label: "All Barangays", meta: String(enterpriseAccounts.length) },
      ...barangayDirectoryItems.map((item) => ({ value: item.label, label: `Barangay ${item.label}`, meta: String(item.enterpriseCount), searchText: item.subtitle })),
    ],
    [barangayDirectoryItems, enterpriseAccounts.length],
  );

  const selectedBarangayEnterprises = useMemo(() => (selectedBarangayName ? getEnterprisesByBarangay(mapEnterprises, selectedBarangayName) : []), [mapEnterprises, selectedBarangayName]);
  const selectedBarangayUnpinnedEnterprises = useMemo(
    () => (selectedBarangayName ? unpinnedEnterprises.filter((enterprise) => normalizeBarangayName(enterprise.barangay ?? "Unassigned") === normalizeBarangayName(selectedBarangayName)) : []),
    [selectedBarangayName, unpinnedEnterprises],
  );
  const visibleEnterprises = selectedBarangayName ? selectedBarangayEnterprises : mapEnterprises;
  const selectedEnterprise = selectedEnterpriseId === null ? null : (mapEnterprises.find((enterprise) => enterprise.id === selectedEnterpriseId) ?? null);

  const applyBoundarySelection = useCallback(
    (barangayName: string | null) => {
      const selectedKey = barangayName ? normalizeBarangayName(barangayName) : "";

      boundaryLayerRef.current?.getLayers().forEach((layer) => {
        if (!(layer instanceof L.Path)) return;

        if (!barangayName) {
          boundaryLayerRef.current?.resetStyle(layer);
          return;
        }

        const featureItem = "feature" in layer ? (layer.feature as GeoJSON.Feature | undefined) : undefined;
        const layerKey = normalizeBarangayName(getBarangayLabel(featureItem));

        if (layerKey === selectedKey) {
          layer.setStyle(getActiveBoundaryStyle(mapTheme));
          activeBoundaryRef.current = layer;
          layer.bringToFront();
          return;
        }

        layer.setStyle(getDimmedBoundaryStyle(mapTheme));
      });
    },
    [mapTheme],
  );

  const findBoundaryLayerByName = useCallback((barangayName: string) => {
    const selectedKey = normalizeBarangayName(barangayName);

    return boundaryLayerRef.current?.getLayers().find((layer) => {
      if (!("feature" in layer)) return false;

      const featureItem = layer.feature as GeoJSON.Feature | undefined;
      return normalizeBarangayName(getBarangayLabel(featureItem)) === selectedKey;
    }) as (L.Path & { feature?: GeoJSON.Feature }) | undefined;
  }, []);

  const selectBarangay = useCallback(
    (barangayName: string, layer?: L.Path) => {
      const targetLayer = layer ?? findBoundaryLayerByName(barangayName);
      selectedBarangayNameRef.current = barangayName;
      setSelectedBarangayName(barangayName);
      setSelectedEnterpriseId(null);
      setInsightEnterpriseId(null);
      applyBoundarySelection(barangayName);

      const map = mapRef.current;
      if (!map || !targetLayer || !(targetLayer instanceof L.Polygon)) return;

      const bounds = targetLayer.getBounds();
      if (!bounds?.isValid()) return;

      const mapSize = map.getSize();
      const shouldOffsetForSidebar = !isDirectoryCollapsed && mapSize.x >= 820;

      map.stop();
      map.flyToBounds(bounds.pad(0.38), {
        animate: true,
        duration: 0.95,
        easeLinearity: 0.18,
        maxZoom: 14.35,
        paddingTopLeft: shouldOffsetForSidebar ? [410, 56] : [36, 36],
        paddingBottomRight: [56, 56],
      });
      targetLayer.openTooltip();
    },
    [applyBoundarySelection, findBoundaryLayerByName, isDirectoryCollapsed],
  );

  const clearSelectedBarangay = useCallback(() => {
    selectedBarangayNameRef.current = null;
    setSelectedBarangayName(null);
    setSelectedEnterpriseId(null);
    setInsightEnterpriseId(null);
    applyBoundarySelection(null);

    if (mapRef.current) {
      fitMapToSanPedroBounds(mapRef.current, boundaryLayerRef.current);
    }
  }, [applyBoundarySelection]);

  const closeEnterpriseDetails = useCallback(() => {
    setSelectedEnterpriseId(null);
    mapRef.current?.closePopup();
  }, []);

  useEffect(() => {
    if (!selectedEnterprise) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeEnterpriseDetails();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeEnterpriseDetails, selectedEnterprise]);

  useEffect(() => {
    let isMounted = true;

    fetch(SAN_PEDRO_BARANGAYS_URL)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load barangay boundary GeoJSON.");
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
    selectedBarangayNameRef.current = selectedBarangayName;
    applyBoundarySelection(selectedBarangayName);
  }, [applyBoundarySelection, selectedBarangayName]);

  useEffect(() => {
    if (mapRef.current) return undefined;

    const map = L.map(mapContainerId, {
      maxBounds: sanPedroRelaxedFallbackBounds,
      maxBoundsViscosity: 0.35,
      maxZoom: 18,
      minZoom: 11.2,
      zoomControl: false,
    }).setView(sanPedroFallbackCenter, 11.65);
    mapRef.current = map;

    map.createPane("boundaryPane");
    const boundaryPane = map.getPane("boundaryPane");
    if (boundaryPane) {
      boundaryPane.style.zIndex = "410";
    }

    const cleanupTileLayer = mountLeafletThemeLayer(map, setMapTheme);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    return () => {
      cleanupTileLayer();
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      activeBoundaryRef.current = null;
      boundaryLayerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary) return;

    boundaryLayerRef.current?.remove();
    activeBoundaryRef.current = null;

    const boundaryStyle: GeoJSONOptions["style"] = (geoFeature) => {
      const name = getBarangayLabel(geoFeature);
      return getBaseBoundaryStyle(name, mapTheme, "boundaryPane", "admin");
    };

    const onEachFeature: GeoJSONOptions["onEachFeature"] = (geoFeature, layer: Layer) => {
      const name = getBarangayLabel(geoFeature);
      layer.bindTooltip(createBoundaryTooltipHtml(name), {
        sticky: true,
        direction: "auto",
        opacity: 0.95,
      });
      layer.bindPopup(createBoundaryPopupHtml(geoFeature), {
        closeButton: false,
      });
      layer.on({
        mouseover: (event) => {
          const target = event.target as L.Path;
          const isActive = activeBoundaryRef.current === target;
          target.setStyle(isActive ? getActiveBoundaryStyle(mapTheme) : getHoverBoundaryStyle(mapTheme));
          target.bringToFront();
        },
        mouseout: (event) => {
          const target = event.target as L.Path;
          if (activeBoundaryRef.current === target) {
            target.setStyle(getActiveBoundaryStyle(mapTheme));
            return;
          }

          applyBoundarySelection(selectedBarangayNameRef.current);
        },
        click: (event) => selectBarangay(name, event.target as L.Path),
      });
    };

    boundaryLayerRef.current = L.geoJSON(boundary, {
      style: boundaryStyle,
      onEachFeature,
    });

    if (showBoundaries) {
      boundaryLayerRef.current.addTo(map);
    }

    applyBoundarySelection(selectedBarangayNameRef.current);
    if (!selectedBarangayNameRef.current && !hasInitialOverviewFitRef.current) {
      fitMapToSanPedroBounds(map, boundaryLayerRef.current);
      hasInitialOverviewFitRef.current = true;
    }
  }, [applyBoundarySelection, boundary, mapTheme, selectBarangay, showBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const timers = [0, 120, 280].map((delay) =>
      window.setTimeout(() => {
        map.invalidateSize({ pan: false });
        const boundaryLayer = boundaryLayerRef.current;

        if (!selectedBarangayNameRef.current && boundaryLayer) {
          fitMapToSanPedroBounds(map, boundaryLayer);
          hasInitialOverviewFitRef.current = true;
        }
        applyBoundarySelection(selectedBarangayNameRef.current);
      }, delay),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [applyBoundarySelection, isDirectoryCollapsed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    visibleEnterprises.forEach((enterprise) => {
      const color = getEnterpriseStatusColor(enterprise.status);
      const markerOutline = mapTheme === "dark" ? "#dbeafe" : "#ffffff";
      const markerShadow = mapTheme === "dark" ? "0 0 0 2px rgba(8,17,31,.72),0 8px 20px rgba(0,0,0,.58)" : "0 2px 8px rgba(0,0,0,.45)";
      const marker = L.marker([enterprise.lat, enterprise.lng], {
        icon: L.divIcon({
          className: enterprise.status === "Critical" ? "tanaw-map-pin animate-pulse" : "tanaw-map-pin",
          iconAnchor: [8, 8],
          popupAnchor: [0, -10],
          html: `<span style="background-color:${color};width:18px;height:18px;display:block;border-radius:50%;border:3px solid ${markerOutline};box-shadow:${markerShadow};"></span>`,
        }),
      }).addTo(map);

      marker.bindTooltip(createTooltipHtml(enterprise, color), {
        direction: "top",
        offset: [0, -10],
        opacity: 0.95,
      });
      marker.bindPopup(createPopupHtml(enterprise, color), {
        closeButton: false,
      });
      marker.on("click", () => {
        selectBarangay(enterprise.barangay);
        setSelectedEnterpriseId(enterprise.id);
      });
      markersRef.current[enterprise.id] = marker;
    });
  }, [mapTheme, selectBarangay, visibleEnterprises]);

  useEffect(() => {
    if (!selectedEnterpriseId || !mapRef.current || !markersRef.current[selectedEnterpriseId]) return;

    const enterprise = mapEnterprises.find((item) => item.id === selectedEnterpriseId);
    if (!enterprise) return;

    mapRef.current.flyTo([enterprise.lat, enterprise.lng], 16, {
      duration: 1.1,
      easeLinearity: 0.25,
    });
    markersRef.current[selectedEnterpriseId].openPopup();
  }, [mapEnterprises, selectedEnterpriseId]);

  return (
    <div className="bg-tanaw-gray relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div id={mapContainerId} className="h-full w-full" />
      </div>

      <AnimatePresence>
        {(isBoundaryLoading || isBoundaryError) && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`tanaw-map-status absolute top-4 right-4 z-420 flex max-w-xs items-center gap-3 rounded-xl border px-4 py-3 text-xs font-bold shadow-[0_18px_46px_rgba(0,0,0,0.38)] backdrop-blur-xl ${
              isBoundaryError ? "border-red-300/30 bg-[#2b1620]/92 text-red-100" : "border-slate-400/30 bg-[#0d192b]/92 text-slate-100"
            }`}
          >
            <RefreshCw size={16} className={isBoundaryLoading ? "animate-spin text-emerald-300" : "text-red-300"} aria-hidden="true" />
            <span>{isBoundaryError ? "Barangay boundaries are temporarily unavailable." : "Loading barangay boundaries..."}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {!isInsightsOpen && (
        <motion.button
          type="button"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => setIsInsightsOpen(true)}
          className={`absolute right-4 z-420 inline-flex items-center gap-2 rounded-xl border border-slate-400/35 bg-[#0b1527]/92 px-4 py-3 text-xs font-black tracking-wide text-white uppercase shadow-[0_18px_46px_rgba(0,0,0,0.44)] backdrop-blur-xl transition-all hover:border-emerald-300/45 hover:bg-[#132139] ${isBoundaryLoading || isBoundaryError ? "top-20" : "top-4"}`}
        >
          <BarChart3 size={16} className="text-emerald-300" />
          Visitor Insights
        </motion.button>
      )}

      <AnimatePresence>
        {isInsightsOpen && (
          <VisitorInsightsDrawer
            range={insightRange}
            enterpriseId={insightEnterpriseId ?? undefined}
            barangay={insightEnterpriseId ? undefined : (selectedBarangayName ?? undefined)}
            onRangeChange={setInsightRange}
            onShowArea={() => setInsightEnterpriseId(null)}
            onClose={() => setIsInsightsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {!isDirectoryCollapsed && (
          <motion.aside
            id="spatial-directory-panel"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="tanaw-map-directory absolute top-4 bottom-4 left-4 z-420 flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-400/35 bg-[#0b1527]/92 shadow-[0_28px_80px_rgba(0,0,0,0.52)] ring-1 ring-white/8 backdrop-blur-xl"
          >
            {/* Header section (Fixed size, shrink-0) */}
            <div className="tanaw-map-directory__header flex shrink-0 flex-col gap-3 border-b border-slate-500/35 bg-[#111f34]/90 px-4 py-3.5">
              <div className="relative z-10 flex items-start justify-between gap-3">
                <div>
                  <span className="flex items-center gap-2 text-[10px] font-black tracking-widest text-white uppercase">
                    <MapIcon size={14} className="text-tanaw-sky" /> Spatial Directory
                  </span>
                  <p className="mt-1 text-[9px] font-bold tracking-widest text-white/65 uppercase">
                    {selectedBarangayName
                      ? `${selectedBarangayEnterprises.length} registered enterprises`
                      : isBoundaryLoading
                        ? "Loading refined boundaries"
                        : isBoundaryError
                          ? "Boundary layer unavailable"
                          : enterpriseAccountsQuery.isError || mapEnterprisesQuery.isError
                            ? "Enterprise registry unavailable"
                            : enterpriseAccountsQuery.isLoading || mapEnterprisesQuery.isLoading
                              ? "Loading enterprises"
                              : `${boundaryFeatureCount} barangay boundaries`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title={showBoundaries ? "Hide barangay boundaries" : "Show barangay boundaries"}
                    aria-pressed={showBoundaries}
                    onClick={() => setShowBoundaries((value) => !value)}
                    className={`focus:ring-tanaw-sky rounded border px-2 py-1 text-[9px] font-black tracking-widest uppercase transition focus:ring-2 focus:outline-none ${showBoundaries ? "border-emerald-400/45 bg-emerald-500/25 text-white shadow-sm shadow-emerald-950/30" : "border-white/20 bg-white/10 text-white/75 hover:border-white/30 hover:bg-white/15 hover:text-white"}`}
                  >
                    Boundaries
                  </button>
                  <button
                    type="button"
                    aria-controls="spatial-directory-panel"
                    aria-label="Collapse spatial directory"
                    title="Collapse spatial directory"
                    onClick={() => setIsDirectoryCollapsed(true)}
                    className="focus:ring-tanaw-sky flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/20 bg-white/10 text-white/80 transition hover:border-white/30 hover:bg-white/15 hover:text-white focus:ring-2 focus:outline-none"
                  >
                    <PanelLeftClose size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* Dropdown Selector section (Fixed size, shrink-0, overflow-visible for dropdown menu) */}
            <div className="tanaw-map-directory__selector relative z-20 shrink-0 overflow-visible border-b border-slate-500/30 bg-[#0d192b]/92 px-4 py-3.5">
              <SelectDropdown
                label="Select Barangay"
                ariaLabel="Select barangay"
                value={selectedBarangayName ?? ""}
                options={barangayDropdownOptions}
                onChange={(barangayName) => (barangayName ? selectBarangay(barangayName) : clearSelectedBarangay())}
                searchable
                searchPlaceholder="Search barangay..."
                variant="directory"
              />
            </div>

            {/* Scrollable details and enterprise list container */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                {selectedBarangayName ? (
                  <motion.div
                    key={`barangay-enterprises-${normalizeBarangayName(selectedBarangayName)}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.24, ease: "easeOut" }}
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3"
                  >
                    <button
                      type="button"
                      onClick={clearSelectedBarangay}
                      className="focus:ring-tanaw-sky flex shrink-0 items-center gap-2 rounded-lg border border-white/15 bg-slate-950/35 px-3 py-2 text-left text-[9px] font-black tracking-widest text-white/75 uppercase transition hover:border-white/25 hover:bg-slate-950/50 hover:text-white focus:ring-2 focus:outline-none"
                    >
                      <ArrowLeft size={12} className="text-tanaw-sky" />
                      Back to Barangay Directory
                    </button>

                    {/* Selected Barangay Info */}
                    <div className="tanaw-map-directory__card shrink-0 rounded-xl border border-slate-400/25 bg-[#15233a]/82 p-3.5 shadow-sm shadow-black/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-black tracking-wide text-white uppercase">Barangay {selectedBarangayName}</h3>
                          <p className="mt-1 text-[9px] font-bold tracking-widest text-white/65 uppercase">Enterprises within this barangay</p>
                        </div>
                        <span className="shrink-0 rounded border border-white/15 bg-black/35 px-2 py-1 font-mono text-[9px] font-black tracking-widest text-white uppercase">
                          {selectedBarangayEnterprises.length + selectedBarangayUnpinnedEnterprises.length}
                        </span>
                      </div>
                    </div>

                    {/* Dedicated Enterprise List section at the bottom */}
                    <div className="tanaw-map-directory__card flex min-h-0 flex-1 flex-col rounded-xl border border-slate-400/25 bg-[#111e32]/88 p-3.5 shadow-sm shadow-black/20">
                      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
                        <h3 className="flex items-center gap-2 text-[9px] font-black tracking-widest text-white/80 uppercase">
                          <Building2 size={13} className="text-tanaw-sky" />
                          Enterprises within this Barangay
                        </h3>
                        <span className="text-[9px] font-bold tracking-widest text-white/65 uppercase">{selectedBarangayEnterprises.length + selectedBarangayUnpinnedEnterprises.length}</span>
                      </div>
                      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                        {selectedBarangayEnterprises.map((enterprise, index) => (
                          <motion.div
                            key={enterprise.id}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.12), ease: "easeOut" }}
                          >
                            <EnterpriseMapCard enterprise={enterprise} selected={selectedEnterpriseId === enterprise.id} onClick={() => setSelectedEnterpriseId(enterprise.id)} />
                          </motion.div>
                        ))}
                        {selectedBarangayUnpinnedEnterprises.map((enterprise) => (
                          <UnpinnedEnterpriseCard key={enterprise.id} enterprise={enterprise} />
                        ))}
                        {selectedBarangayEnterprises.length === 0 && selectedBarangayUnpinnedEnterprises.length === 0 && (
                          <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.22, ease: "easeOut" }}
                            className="rounded-lg border border-white/15 bg-black/20 p-6 text-center text-[10px] font-bold tracking-widest text-white/65 uppercase"
                          >
                            {enterpriseAccountsQuery.isError || mapEnterprisesQuery.isError ? "Unable to load enterprise registry." : "No registered enterprises found for this barangay yet."}
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="all-enterprises-view"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3"
                  >
                    {/* Prompt card */}
                    <div className="tanaw-map-directory__card shrink-0 rounded-xl border border-slate-400/25 bg-[#15233a]/82 p-3.5 text-center shadow-sm shadow-black/20">
                      <MapPin size={18} className="text-tanaw-sky mx-auto mb-1.5 animate-bounce" style={{ animationDuration: "3s" }} />
                      <h4 className="text-[10px] font-black tracking-widest text-white uppercase">No Barangay Selected</h4>
                      <p className="mt-1 text-[9px] leading-normal font-bold tracking-widest text-white/65 uppercase">Click a barangay boundary on the map or use the dropdown above to filter.</p>
                    </div>

                    {/* Dedicated Enterprise List section showing all enterprises */}
                    <div className="tanaw-map-directory__card flex min-h-0 flex-1 flex-col rounded-xl border border-slate-400/25 bg-[#111e32]/88 p-3.5 shadow-sm shadow-black/20">
                      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
                        <h3 className="flex items-center gap-2 text-[9px] font-black tracking-widest text-white/80 uppercase">
                          <Building2 size={13} className="text-tanaw-sky" />
                          All Enterprises
                        </h3>
                        <span className="text-[9px] font-bold tracking-widest text-white/65 uppercase">
                          {unpinnedEnterpriseCount > 0 ? `${mapEnterprises.length} pinned / ${unpinnedEnterpriseCount} unpinned` : enterpriseAccounts.length}
                        </span>
                      </div>
                      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                        {mapEnterprises.map((enterprise) => (
                          <EnterpriseMapCard
                            key={enterprise.id}
                            enterprise={enterprise}
                            selected={selectedEnterpriseId === enterprise.id}
                            onClick={() => {
                              selectBarangay(enterprise.barangay);
                              setSelectedEnterpriseId(enterprise.id);
                            }}
                          />
                        ))}
                        {unpinnedEnterprises.map((enterprise) => (
                          <UnpinnedEnterpriseCard key={enterprise.id} enterprise={enterprise} />
                        ))}
                        {enterpriseAccounts.length === 0 && (
                          <div className="rounded-lg border border-white/15 bg-black/20 p-6 text-center text-[10px] font-bold tracking-widest text-white/65 uppercase">
                            {enterpriseAccountsQuery.isError || mapEnterprisesQuery.isError ? (
                              <div className="flex flex-col items-center gap-3">
                                <span>Unable to load enterprise registry.</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void enterpriseAccountsQuery.refetch();
                                    void mapEnterprisesQuery.refetch();
                                  }}
                                  className="focus:ring-tanaw-sky inline-flex items-center gap-1.5 rounded border border-white/20 bg-white/10 px-2 py-1 text-[9px] font-black tracking-widest text-white transition hover:bg-white/15 focus:ring-2 focus:outline-none"
                                >
                                  <RefreshCw size={11} />
                                  Retry
                                </button>
                              </div>
                            ) : enterpriseAccountsQuery.isLoading || mapEnterprisesQuery.isLoading ? (
                              "Loading enterprises..."
                            ) : (
                              "No pinned enterprise locations yet."
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {isDirectoryCollapsed && (
        <motion.button
          type="button"
          aria-controls="spatial-directory-panel"
          aria-label="Expand spatial directory"
          title="Expand spatial directory"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={() => setIsDirectoryCollapsed(false)}
          className="focus:ring-tanaw-sky absolute top-4 left-4 z-430 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-400/35 bg-[#0b1527]/92 text-white shadow-[0_18px_46px_rgba(0,0,0,0.44)] backdrop-blur-xl transition hover:border-slate-300/45 hover:bg-[#132139] focus:ring-2 focus:outline-none"
        >
          <PanelLeftOpen size={18} />
        </motion.button>
      )}

      <AnimatePresence>
        {selectedEnterprise && (
          <EnterpriseDetailsModal
            enterprise={selectedEnterprise}
            onClose={closeEnterpriseDetails}
            onOpenInsights={() => {
              setInsightEnterpriseId(selectedEnterprise.id);
              setIsInsightsOpen(true);
              closeEnterpriseDetails();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function EnterpriseMapCard({ enterprise, selected, onClick }: { enterprise: MapEnterprise; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus:ring-tanaw-sky w-full rounded-lg border p-3 text-left shadow-sm shadow-black/15 transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/10 focus:ring-2 focus:outline-none ${selected ? "border-tanaw-sky/60 bg-tanaw-sky/15" : "border-white/15 bg-slate-950/35"}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] leading-tight font-bold text-white">{enterprise.name}</h4>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-white/70 uppercase">
            <MapPin size={10} className="shrink-0" />
            <span className="truncate">{enterprise.fullAddress}</span>
          </div>
        </div>
        <span className={`flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[9px] font-black tracking-widest uppercase ${getDarkStatusBadgeClass(enterprise.status)}`}>
          {enterprise.status}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-2 font-mono text-[10px]">
        <span className="truncate text-white/70">{enterprise.category}</span>
        <span className="flex items-center justify-end gap-1 font-bold text-white">
          <Activity size={12} className="text-tanaw-sky" />
          {enterprise.totalLiveOccupancy.toLocaleString()}
        </span>
        <span className="text-white/70">Est. Unique</span>
        <span className="text-right font-bold text-white">{enterprise.estimatedUniqueCount.toLocaleString()}</span>
      </div>
    </button>
  );
}

function UnpinnedEnterpriseCard({ enterprise }: { enterprise: AccountSummary }) {
  const statusLabel = enterprise.latitude === null || enterprise.longitude === null ? "Not Pinned" : "Needs Correction";

  return (
    <div className="w-full rounded-lg border border-dashed border-white/15 bg-slate-950/25 p-3 text-left shadow-sm shadow-black/15">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] leading-tight font-bold text-white">{enterprise.enterpriseName ?? enterprise.displayName}</h4>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-white/70 uppercase">
            <MapPin size={10} className="shrink-0" />
            <span className="truncate">{enterprise.address ?? "Address not provided"}</span>
          </div>
        </div>
        <span className="flex shrink-0 items-center rounded border border-amber-400/30 bg-amber-900/35 px-1.5 py-0.5 text-[9px] font-black tracking-widest text-amber-100 uppercase">
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-2 font-mono text-[10px]">
        <span className="truncate text-white/70">{enterprise.category ?? "Uncategorized"}</span>
        <span className="truncate text-right font-bold text-white">{enterprise.barangay ?? "Unassigned"}</span>
      </div>
    </div>
  );
}

function hasUsableSanPedroCoordinates(boundary: GeoJsonFeatureCollection | null, enterprise: AccountSummary) {
  if (enterprise.latitude === null || enterprise.longitude === null) return false;
  return isPointInsideSanPedro(boundary, enterprise.latitude, enterprise.longitude);
}
