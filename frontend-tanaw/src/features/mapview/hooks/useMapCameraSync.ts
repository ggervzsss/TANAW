import L from "leaflet";
import { useEffect } from "react";
import type { MapEnterprise } from "@/shared/types";
import { normalizeBarangayName, type GeoJsonFeatureCollection, type MapCameraTarget } from "../utils";
import type { MapMotionController } from "../utils";

type MutableRef<T> = { current: T };

type MapCameraSyncOptions = {
  barangayBoundsRef: MutableRef<Map<string, L.LatLngBounds>>;
  boundary: GeoJsonFeatureCollection | null;
  boundaryLayerRef: MutableRef<L.GeoJSON | null>;
  cameraTarget: MapCameraTarget;
  citywideBoundsRef: MutableRef<L.LatLngBounds | null>;
  findBoundaryLayerByName: (barangayName: string) => (L.Path & { feature?: GeoJSON.Feature }) | undefined;
  initializedMapInstanceRef: MutableRef<L.Map | null>;
  isDirectoryCollapsed: boolean;
  lastCameraCommandKeyRef: MutableRef<string | null>;
  mapEnterprises: MapEnterprise[];
  mapMotionControllerRef: MutableRef<MapMotionController | null>;
  mapRef: MutableRef<L.Map | null>;
  onReady: () => void;
};

export function useMapCameraSync(options: MapCameraSyncOptions) {
  const {
    barangayBoundsRef,
    boundary,
    boundaryLayerRef,
    cameraTarget,
    citywideBoundsRef,
    findBoundaryLayerByName,
    initializedMapInstanceRef,
    isDirectoryCollapsed,
    lastCameraCommandKeyRef,
    mapEnterprises,
    mapMotionControllerRef,
    mapRef,
    onReady,
  } = options;

  useEffect(() => {
    const map = mapRef.current;
    const motionController = mapMotionControllerRef.current;
    const boundaryLayer = boundaryLayerRef.current;
    if (!map || !motionController || !boundaryLayer) return;

    let commandKey: string;
    if (cameraTarget.type === "citywide") {
      const bounds = citywideBoundsRef.current ?? boundaryLayer.getBounds();
      if (!bounds.isValid()) return;
      commandKey = `citywide:${isDirectoryCollapsed ? "collapsed" : "expanded"}`;
      if (lastCameraCommandKeyRef.current === commandKey) return;
      motionController.setTarget({ type: "citywide", bounds }, { directoryCollapsed: isDirectoryCollapsed, immediate: initializedMapInstanceRef.current !== map });
    } else if (cameraTarget.type === "barangay") {
      const targetLayer = findBoundaryLayerByName(cameraTarget.barangayName);
      if (!targetLayer || !(targetLayer instanceof L.Polygon)) return;
      const bounds = barangayBoundsRef.current.get(normalizeBarangayName(cameraTarget.barangayName)) ?? targetLayer.getBounds();
      if (!bounds.isValid()) return;
      commandKey = `barangay:${normalizeBarangayName(cameraTarget.barangayName)}:${isDirectoryCollapsed ? "collapsed" : "expanded"}`;
      if (lastCameraCommandKeyRef.current === commandKey) return;
      motionController.setTarget({ type: "barangay", bounds }, { directoryCollapsed: isDirectoryCollapsed });
    } else {
      const enterprise = mapEnterprises.find((item) => item.id === cameraTarget.enterpriseId);
      if (!enterprise) return;
      commandKey = `enterprise:${enterprise.id}:${enterprise.lat}:${enterprise.lng}:${isDirectoryCollapsed ? "collapsed" : "expanded"}`;
      if (lastCameraCommandKeyRef.current === commandKey) return;
      motionController.setTarget({ type: "enterprise", center: [enterprise.lat, enterprise.lng], zoom: 16 }, { directoryCollapsed: isDirectoryCollapsed });
    }

    if (initializedMapInstanceRef.current !== map) {
      initializedMapInstanceRef.current = map;
      onReady();
    }
    lastCameraCommandKeyRef.current = commandKey;
  }, [
    barangayBoundsRef,
    boundary,
    boundaryLayerRef,
    cameraTarget,
    citywideBoundsRef,
    findBoundaryLayerByName,
    initializedMapInstanceRef,
    isDirectoryCollapsed,
    lastCameraCommandKeyRef,
    mapEnterprises,
    mapMotionControllerRef,
    mapRef,
    onReady,
  ]);
}
