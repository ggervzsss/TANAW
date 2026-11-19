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
  lastCameraTargetRef: MutableRef<MapCameraTarget | null>;
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
    lastCameraTargetRef,
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

    if (initializedMapInstanceRef.current !== map) {
      const bounds = citywideBoundsRef.current ?? boundaryLayer.getBounds();
      if (!bounds.isValid()) return;
      motionController.setTarget({ type: "citywide", bounds }, { immediate: true });
      initializedMapInstanceRef.current = map;
      lastCameraTargetRef.current = cameraTarget.type === "citywide" ? cameraTarget : null;
      onReady();
    }
    if (lastCameraTargetRef.current === cameraTarget) return;

    if (cameraTarget.type === "barangay") {
      const targetLayer = findBoundaryLayerByName(cameraTarget.barangayName);
      if (!targetLayer || !(targetLayer instanceof L.Polygon)) return;
      const bounds = barangayBoundsRef.current.get(normalizeBarangayName(cameraTarget.barangayName)) ?? targetLayer.getBounds();
      if (!bounds.isValid()) return;
      motionController.setTarget({ type: "barangay", bounds });
    } else if (cameraTarget.type === "enterprise") {
      const enterprise = mapEnterprises.find((item) => item.id === cameraTarget.enterpriseId);
      if (!enterprise) return;
      motionController.setTarget({ type: "enterprise", center: [enterprise.lat, enterprise.lng] });
    } else if (cameraTarget.fit) {
      const bounds = citywideBoundsRef.current ?? boundaryLayer.getBounds();
      if (!bounds.isValid()) return;
      motionController.setTarget({ type: "citywide", bounds });
    } else {
      motionController.clearPendingSelection();
    }
    lastCameraTargetRef.current = cameraTarget;
  }, [
    barangayBoundsRef,
    boundary,
    boundaryLayerRef,
    cameraTarget,
    citywideBoundsRef,
    findBoundaryLayerByName,
    initializedMapInstanceRef,
    lastCameraTargetRef,
    mapEnterprises,
    mapMotionControllerRef,
    mapRef,
    onReady,
  ]);
}
