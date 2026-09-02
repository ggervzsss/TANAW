import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Camera, CameraStatus } from "../../../types/enterprise";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getMlCameraStates,
  getMlHealth,
  getMlServiceStatus,
  restartMlService,
  startCameraProcessing,
  stopCameraProcessing,
  testCameraConnection,
  type MlCameraLiveState,
  type MlCameraStates,
  type MlHealth,
  type MlServiceStatus,
} from "../services/ml-service";
import {
  cameraStatusFromRuntime,
  clearRecoveredCameraRequestErrors,
  isAcceptedCameraStartSettled,
  isCameraPreviewReady,
  isCameraStartOutcomeUncertain,
  isTransientCameraStartupPollError,
  mergeCameraStates,
} from "../utils/camera-live-state";
import { isRuntimeStatus, isStartAction, toErrorMessage, updateCamerasWhenChanged, type CameraAction } from "../model/camera-management";
import { useCameraRuntimeUpdates } from "./useCameraRuntimeUpdates";
import { CAMERA_START_SETTLE_TIMEOUT_MESSAGE, CAMERA_START_SETTLE_TIMEOUT_MS, useCameraStartDeadlineMonitor } from "./useCameraStartDeadlineMonitor";

type CameraRuntimeControllerOptions = {
  activeCam: Camera | undefined;
  cameras: Camera[];
  setCameras: Dispatch<SetStateAction<Camera[]>>;
  storageKey: string;
};

export function useCameraRuntimeController({ activeCam, cameras, setCameras, storageKey }: CameraRuntimeControllerOptions) {
  const [cameraStates, setCameraStates] = useState<Record<number, MlCameraLiveState>>({});
  const [cameraErrors, setCameraErrors] = useState<Record<number, string | null>>({});
  const [cameraActions, setCameraActions] = useState<Record<number, CameraAction | undefined>>({});
  const cameraActionsRef = useRef(cameraActions);
  const cameraStartDeadlinesRef = useRef<Record<number, number>>({});
  const cameraPreviewReadyRef = useRef<Record<number, boolean>>({});
  const [pendingCameraIds, setPendingCameraIds] = useState<ReadonlySet<number>>(new Set());
  const [streamVersions, setStreamVersions] = useState<Record<number, number>>({});
  const [serviceStatus, setServiceStatus] = useState<MlServiceStatus | null>(null);
  const [serviceHealth, setServiceHealth] = useState<MlHealth | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [isRestartingService, setIsRestartingService] = useState(false);
  const servicePidRef = useRef<number | null>(null);
  const activeCameraIds = useMemo(() => new Set(cameras.map((camera) => camera.id)), [cameras]);
  const activeCameraIdsRef = useRef(activeCameraIds);
  const mlBaseUrl = serviceStatus?.baseUrl ?? DEFAULT_ML_SERVICE_BASE_URL;

  useEffect(() => {
    cameraActionsRef.current = cameraActions;
  }, [cameraActions]);
  useEffect(() => {
    activeCameraIdsRef.current = activeCameraIds;
  }, [activeCameraIds]);

  const updateCameraStatus = useCallback(
    (cameraId: number, status: CameraStatus) => {
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => (camera.id === cameraId && camera.status !== status ? { ...camera, status } : camera)));
    },
    [setCameras],
  );

  const setCameraError = useCallback((cameraId: number, error: string | null) => {
    setCameraErrors((current) => ({ ...current, [cameraId]: error }));
  }, []);

  const setCameraAction = useCallback((cameraId: number, action?: CameraAction) => {
    setCameraActions((current) => {
      const next = { ...current, [cameraId]: action };
      cameraActionsRef.current = next;
      return next;
    });
  }, []);

  const bumpStreamVersion = useCallback((cameraId: number) => {
    setStreamVersions((current) => ({ ...current, [cameraId]: (current[cameraId] ?? 0) + 1 }));
  }, []);

  const beginCameraStart = useCallback(
    (cameraId: number) => {
      cameraStartDeadlinesRef.current[cameraId] = Date.now() + CAMERA_START_SETTLE_TIMEOUT_MS;
      cameraPreviewReadyRef.current[cameraId] = false;
      setCameraAction(cameraId, "requesting-start");
      setCameraError(cameraId, null);
      setServiceError(null);
      updateCameraStatus(cameraId, "starting");
    },
    [setCameraAction, setCameraError, updateCameraStatus],
  );

  const handleCameraStartFailure = useCallback(
    (cameraId: number, error: unknown) => {
      if (isCameraStartOutcomeUncertain(error)) {
        setCameraAction(cameraId, "starting");
        return true;
      }
      delete cameraStartDeadlinesRef.current[cameraId];
      setCameraAction(cameraId);
      updateCameraStatus(cameraId, "error");
      setCameraError(cameraId, toErrorMessage(error));
      return false;
    },
    [setCameraAction, setCameraError, updateCameraStatus],
  );

  const applyCameraStates = useCallback(
    (payload: MlCameraStates) => {
      const registeredCameraIds = activeCameraIdsRef.current;
      const nextStates = payload.cameras.filter((state) => registeredCameraIds.has(state.camera_id));
      const expiredStartIds = new Set<number>();
      const now = Date.now();
      for (const [cameraIdText, action] of Object.entries(cameraActionsRef.current)) {
        const cameraId = Number(cameraIdText);
        const deadline = cameraStartDeadlinesRef.current[cameraId];
        if (isStartAction(action) && deadline !== undefined && now >= deadline && !isAcceptedCameraStartSettled(payload, cameraId)) {
          expiredStartIds.add(cameraId);
          delete cameraStartDeadlinesRef.current[cameraId];
        }
      }

      const newlyReadyCameraIds: number[] = [];
      const nextPreviewReady: Record<number, boolean> = {};
      for (const state of nextStates) {
        const ready = isCameraPreviewReady(state);
        nextPreviewReady[state.camera_id] = ready;
        if (ready && !cameraPreviewReadyRef.current[state.camera_id]) newlyReadyCameraIds.push(state.camera_id);
      }
      cameraPreviewReadyRef.current = nextPreviewReady;
      if (newlyReadyCameraIds.length > 0) {
        setStreamVersions((current) => {
          const next = { ...current };
          for (const cameraId of newlyReadyCameraIds) next[cameraId] = (next[cameraId] ?? 0) + 1;
          return next;
        });
      }

      setPendingCameraIds(new Set(payload.pending_camera_ids.filter((cameraId) => registeredCameraIds.has(cameraId))));
      setCameraStates((current) => mergeCameraStates(current, payload, registeredCameraIds));
      setCameraErrors((current) => {
        const next = clearRecoveredCameraRequestErrors(current, nextStates);
        if (expiredStartIds.size === 0) return next;
        const withExpired = { ...next };
        for (const cameraId of expiredStartIds) withExpired[cameraId] = CAMERA_START_SETTLE_TIMEOUT_MESSAGE;
        return withExpired;
      });
      setCameraActions((current) => {
        let changed = false;
        const next = { ...current };
        for (const [cameraIdText, action] of Object.entries(current)) {
          const cameraId = Number(cameraIdText);
          if (expiredStartIds.has(cameraId) || (action === "starting" && isAcceptedCameraStartSettled(payload, cameraId))) {
            delete next[cameraId];
            delete cameraStartDeadlinesRef.current[cameraId];
            changed = true;
          }
        }
        if (changed) cameraActionsRef.current = next;
        return changed ? next : current;
      });
      setCameras((current) =>
        updateCamerasWhenChanged(current, (camera) => {
          const state = nextStates.find((candidate) => candidate.camera_id === camera.id);
          if (!state) return camera;
          const status = cameraStatusFromRuntime(state);
          if (status === "failed" || status === "error") return camera.status === status ? camera : { ...camera, status };
          const acceptedStartIsPending =
            !expiredStartIds.has(camera.id) &&
            (payload.pending_camera_ids.includes(camera.id) || (isStartAction(cameraActionsRef.current[camera.id]) && !isAcceptedCameraStartSettled(payload, camera.id)));
          if (acceptedStartIsPending) return camera.status === "starting" ? camera : { ...camera, status: "starting" };
          return camera.status === status ? camera : { ...camera, status };
        }),
      );
    },
    [setCameras],
  );

  const resetRuntimeState = useCallback((clearCameraErrors = true) => {
    setCameraStates({});
    if (clearCameraErrors) setCameraErrors({});
    setCameraActions({});
    cameraActionsRef.current = {};
    cameraStartDeadlinesRef.current = {};
    cameraPreviewReadyRef.current = {};
    setPendingCameraIds(new Set());
  }, []);

  const adoptServiceStatus = useCallback((status: MlServiceStatus) => {
    servicePidRef.current = status.pid;
    setServiceStatus(status);
  }, []);

  const refreshMlStatus = useCallback(async () => {
    const nextStatus = await getMlServiceStatus();
    if (servicePidRef.current !== null && nextStatus.pid !== null && servicePidRef.current !== nextStatus.pid) {
      resetRuntimeState();
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => ({ ...camera, status: "stopped" })));
    }
    adoptServiceStatus(nextStatus);
    try {
      setServiceHealth(await getMlHealth(nextStatus.baseUrl));
      setServiceError(null);
    } catch (error) {
      if (isTransientCameraStartupPollError(error, Object.values(cameraActionsRef.current).some(isStartAction))) return;
      setServiceHealth(null);
      setServiceError(toErrorMessage(error));
    }
  }, [adoptServiceStatus, resetRuntimeState, setCameras]);

  const refreshCameraStates = useCallback(async () => {
    try {
      applyCameraStates(await getMlCameraStates(mlBaseUrl));
      setServiceError(null);
    } catch (error) {
      if (!isTransientCameraStartupPollError(error, Object.values(cameraActionsRef.current).some(isStartAction))) setServiceError(toErrorMessage(error));
      throw error;
    }
  }, [applyCameraStates, mlBaseUrl]);

  useCameraRuntimeUpdates({ applyCameraStates, baseUrl: mlBaseUrl, refreshCameraStates, refreshServiceStatus: refreshMlStatus });
  useCameraStartDeadlineMonitor({ cameraActionsRef, cameraStartDeadlinesRef, setCameraActions, setCameraErrors, setCameras });

  const handleTestConnection = useCallback(async () => {
    if (!activeCam) return;
    setCameraAction(activeCam.id, "testing");
    setCameraError(activeCam.id, null);
    try {
      const result = await testCameraConnection(mlBaseUrl, activeCam, storageKey);
      updateCameraStatus(activeCam.id, result.ok ? "online" : "offline");
      setCameraError(activeCam.id, result.ok ? null : result.message);
    } catch (error) {
      updateCameraStatus(activeCam.id, "error");
      setCameraError(activeCam.id, toErrorMessage(error));
    } finally {
      setCameraAction(activeCam.id);
    }
  }, [activeCam, mlBaseUrl, setCameraAction, setCameraError, storageKey, updateCameraStatus]);

  const handleStartProcessing = useCallback(async () => {
    if (!activeCam) return;
    beginCameraStart(activeCam.id);
    try {
      await startCameraProcessing(mlBaseUrl, activeCam, storageKey);
      setCameraAction(activeCam.id, "starting");
      void refreshCameraStates().catch(() => undefined);
    } catch (error) {
      if (handleCameraStartFailure(activeCam.id, error)) void refreshCameraStates().catch(() => undefined);
    }
  }, [activeCam, beginCameraStart, handleCameraStartFailure, mlBaseUrl, refreshCameraStates, setCameraAction, storageKey]);

  const handleStopProcessing = useCallback(async () => {
    if (!activeCam) return;
    setCameraAction(activeCam.id, "stopping");
    delete cameraStartDeadlinesRef.current[activeCam.id];
    setCameraError(activeCam.id, null);
    try {
      await stopCameraProcessing(mlBaseUrl, activeCam.id);
      updateCameraStatus(activeCam.id, "stopped");
      bumpStreamVersion(activeCam.id);
      await refreshCameraStates();
    } catch (error) {
      setCameraError(activeCam.id, toErrorMessage(error));
    } finally {
      setCameraAction(activeCam.id);
    }
  }, [activeCam, bumpStreamVersion, mlBaseUrl, refreshCameraStates, setCameraAction, setCameraError, updateCameraStatus]);

  const handleRestartService = useCallback(async () => {
    setIsRestartingService(true);
    setServiceError(null);
    try {
      const nextStatus = await restartMlService();
      adoptServiceStatus(nextStatus);
      resetRuntimeState(false);
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => (isRuntimeStatus(camera.status) ? { ...camera, status: "stopped" } : camera)));
    } catch (error) {
      setServiceError(toErrorMessage(error));
    } finally {
      setIsRestartingService(false);
    }
  }, [adoptServiceStatus, resetRuntimeState, setCameras]);

  const removeCameraRuntimeState = useCallback((cameraId: number) => {
    setCameraStates((current) => {
      const next = { ...current };
      delete next[cameraId];
      return next;
    });
    delete cameraStartDeadlinesRef.current[cameraId];
    delete cameraPreviewReadyRef.current[cameraId];
  }, []);

  return {
    adoptServiceStatus,
    beginCameraStart,
    bumpStreamVersion,
    cameraActions,
    cameraErrors,
    cameraStates,
    handleCameraStartFailure,
    handleRestartService,
    handleStartProcessing,
    handleStopProcessing,
    handleTestConnection,
    isRestartingService,
    mlBaseUrl,
    pendingCameraIds,
    refreshCameraStates,
    removeCameraRuntimeState,
    resetRuntimeState,
    serviceError,
    serviceHealth,
    serviceStatus,
    setCameraAction,
    setCameraError,
    setServiceError,
    streamVersions,
    updateCameraStatus,
  };
}
