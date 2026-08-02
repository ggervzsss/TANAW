import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { Camera, CameraStatus } from "../../../types/enterprise";
import { createBackoffPoller } from "../../../utils/backoff-poller";
import { createReconnectingWebSocket } from "../../../utils/reconnecting-websocket";
import type { CameraFormValues } from "../types/camera";
import { getValidationWarnings } from "../utils/camera-validation";
import { validateCameraForm, type CameraFormErrors } from "../utils/camera-form-validation";
import {
  cameraStatusFromRuntime,
  clearRecoveredCameraRequestErrors,
  isAcceptedCameraStartSettled,
  isCameraPreviewReady,
  isCameraStartOutcomeUncertain,
  mergeCameraStates,
} from "../utils/camera-live-state";
import { CAMERA_IP_CONFLICT_MESSAGE, canonicalizeCameraIp, findCameraIpConflict } from "../utils/camera-ip-uniqueness";
import { cameraConfigurationLimitMessage, DEFAULT_ENTERPRISE_CAMERA_LIMIT, hasReachedCameraConfigurationLimit } from "../utils/camera-capacity";
import {
  createCameraUpdateGate,
  getCameraSaveRuntimeAction,
  hasCameraConnectionChange,
  hasCameraCountingConfigChange,
  hasCameraRestartRequiredChange,
  mergeConfirmedCameraCountingConfig,
} from "../utils/camera-update";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  EMPTY_ML_COUNTS,
  EMPTY_ML_DETECTIONS,
  getMlCameraStates,
  getMlCameraWebSocketUrl,
  getMlHealth,
  getMlServiceStatus,
  getPreviewStreamUrl,
  listLocalCameras,
  replaceLocalCameras,
  restartMlService,
  startCameraProcessing,
  stopCameraProcessing,
  testCameraConnection,
  updateCameraCountingConfig,
} from "../services/ml-service";
import { MlServiceRequestError, type MlCameraLiveEnvelope, type MlCameraLiveState, type MlCameraStates, type MlHealth, type MlServiceStatus } from "../services/ml-service";
import { deleteCameraCredential, getCameraPasswordReplacement, loadCameraCredentialMetadata, saveCameraCredential, type CameraCredentialMetadataRecords } from "../services/camera-credentials";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";

type CameraManagementOptions = {
  cameras: Camera[];
  setCameras: Dispatch<SetStateAction<Camera[]>>;
  storageKey: string;
};

import {
  applyStoredCameraMetadata,
  DEFAULT_COUNTING_CONFIDENCE,
  DEFAULT_ROI,
  DEFAULT_TRACKING_CONFIDENCE,
  getDefaultTripwires,
  getTripwireSaveErrorMessage,
  isRuntimeStatus,
  isStartAction,
  normalizeCamera,
  redactCameraForStorage,
  toErrorMessage,
  updateCamerasWhenChanged,
  validateCamera,
  type CameraAction,
} from "../model/camera-management";

const emptyCameraForm: CameraFormValues = {
  cameraHost: "",
  name: "",
  password: "",
  rtsp: "",
  rtspStream: "stream2",
  username: "",
  zone: "",
};

const ML_STATUS_FALLBACK_INTERVAL_MS = 10_000;
const ML_STATES_FALLBACK_INTERVAL_MS = 2_500;
const CAMERA_START_SETTLE_TIMEOUT_MS = 90_000;
const CAMERA_START_SETTLE_TIMEOUT_MESSAGE = "Camera startup did not reach a running state within 90 seconds.";

export function useCameraManagement({ cameras, setCameras, storageKey }: CameraManagementOptions) {
  const [activeCamId, setActiveCamId] = useState<number | null>(cameras[0]?.id ?? null);
  const activeCamIdRef = useRef(activeCamId);
  activeCamIdRef.current = activeCamId;
  const [cameraStates, setCameraStates] = useState<Record<number, MlCameraLiveState>>({});
  const [cameraErrors, setCameraErrors] = useState<Record<number, string | null>>({});
  const [cameraActions, setCameraActions] = useState<Record<number, CameraAction | undefined>>({});
  const cameraActionsRef = useRef(cameraActions);
  cameraActionsRef.current = cameraActions;
  const cameraStartDeadlinesRef = useRef<Record<number, number>>({});
  const cameraPreviewReadyRef = useRef<Record<number, boolean>>({});
  const cameraUpdateGateRef = useRef(createCameraUpdateGate());
  const [pendingCameraIds, setPendingCameraIds] = useState<ReadonlySet<number>>(new Set());
  const [streamVersions, setStreamVersions] = useState<Record<number, number>>({});
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCam, setNewCam] = useState<CameraFormValues>(emptyCameraForm);
  const [cameraFormErrors, setCameraFormErrors] = useState<CameraFormErrors>({});
  const [isValidating, setIsValidating] = useState(false);
  const [editForm, setEditForm] = useState<Camera | null>(null);
  const [cameraPendingDelete, setCameraPendingDelete] = useState<Camera | null>(null);
  const [credentialMetadata, setCredentialMetadata] = useState<CameraCredentialMetadataRecords>({});
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<MlServiceStatus | null>(null);
  const [serviceHealth, setServiceHealth] = useState<MlHealth | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [isMlLiveConnected, setIsMlLiveConnected] = useState(false);
  const [isRestartingService, setIsRestartingService] = useState(false);
  const servicePidRef = useRef<number | null>(null);

  const activeCam = cameras.find((camera) => camera.id === activeCamId);
  const activeCameraIds = useMemo(() => new Set(cameras.map((camera) => camera.id)), [cameras]);
  const activeCameraIdsRef = useRef(activeCameraIds);
  activeCameraIdsRef.current = activeCameraIds;
  const activeState = activeCam ? cameraStates[activeCam.id] : undefined;
  const counts = activeState?.counts ?? EMPTY_ML_COUNTS;
  const detections = activeState?.detections ?? EMPTY_ML_DETECTIONS;
  const health = activeState?.health ?? serviceHealth;
  const activeAction = activeCam ? cameraActions[activeCam.id] : undefined;
  const isActiveCameraSaving = activeAction === "saving";
  const isActiveCameraStarting = Boolean(activeCam && (isStartAction(activeAction) || pendingCameraIds.has(activeCam.id)));
  const monitoringError = activeCam ? (activeState?.counts.error ?? cameraErrors[activeCam.id] ?? configurationError ?? serviceError) : (configurationError ?? serviceError);
  const warnings = isEditMode && editForm ? getValidationWarnings(editForm.config) : getValidationWarnings(activeCam?.config);
  const mlBaseUrl = serviceStatus?.baseUrl ?? DEFAULT_ML_SERVICE_BASE_URL;
  const streamVersion = activeCam ? (streamVersions[activeCam.id] ?? 0) : 0;
  const configuredCameraLimit = serviceHealth?.max_configured_cameras ?? DEFAULT_ENTERPRISE_CAMERA_LIMIT;
  const previewIsReady = !isActiveCameraStarting && isCameraPreviewReady(activeState);
  const streamUrl = useMemo(() => getPreviewStreamUrl(mlBaseUrl, activeCam, streamVersion, previewIsReady), [activeCam, mlBaseUrl, previewIsReady, streamVersion]);
  const newCameraIpConflict = useMemo(() => findCameraIpConflict(cameras, newCam.cameraHost), [cameras, newCam.cameraHost]);
  const editedCameraIpConflict = useMemo(() => (editForm ? findCameraIpConflict(cameras, editForm.cameraHost ?? "", editForm.id) : undefined), [cameras, editForm]);

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
          if (status === "failed" || status === "error") {
            return camera.status === status ? camera : { ...camera, status };
          }
          const acceptedStartIsPending =
            !expiredStartIds.has(camera.id) &&
            (payload.pending_camera_ids.includes(camera.id) || (isStartAction(cameraActionsRef.current[camera.id]) && !isAcceptedCameraStartSettled(payload, camera.id)));
          if (acceptedStartIsPending) {
            return camera.status === "starting" ? camera : { ...camera, status: "starting" };
          }
          return camera.status === status ? camera : { ...camera, status };
        }),
      );
    },
    [setCameras],
  );

  const refreshMlStatus = useCallback(async () => {
    const nextStatus = await getMlServiceStatus();
    if (servicePidRef.current !== null && nextStatus.pid !== null && servicePidRef.current !== nextStatus.pid) {
      setCameraStates({});
      setCameraErrors({});
      setCameraActions({});
      cameraActionsRef.current = {};
      cameraStartDeadlinesRef.current = {};
      cameraPreviewReadyRef.current = {};
      setPendingCameraIds(new Set());
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => ({ ...camera, status: "stopped" })));
    }
    servicePidRef.current = nextStatus.pid;
    setServiceStatus(nextStatus);
    try {
      setServiceHealth(await getMlHealth(nextStatus.baseUrl));
      setServiceError(null);
    } catch (error) {
      setServiceHealth(null);
      setServiceError(toErrorMessage(error));
    }
  }, [setCameras]);

  const refreshCameraStates = useCallback(async () => {
    try {
      applyCameraStates(await getMlCameraStates(mlBaseUrl));
      setServiceError(null);
    } catch (error) {
      setServiceError(toErrorMessage(error));
      throw error;
    }
  }, [applyCameraStates, mlBaseUrl]);

  useEffect(() => {
    let disposed = false;
    setHydratedFromStorage(false);
    setServiceError(null);
    setConfigurationError(null);
    setCameraStates({});
    setCameraErrors({});
    setCameraActions({});
    cameraActionsRef.current = {};
    cameraStartDeadlinesRef.current = {};
    cameraPreviewReadyRef.current = {};
    setPendingCameraIds(new Set());
    setCredentialMetadata({});

    const hydrateCameras = async () => {
      try {
        const status = await getMlServiceStatus();
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const [saved, credentials] = await Promise.all([listLocalCameras(baseUrl), loadCameraCredentialMetadata(storageKey)]);
        const normalized = saved.map((camera) => applyStoredCameraMetadata(normalizeCamera(camera), credentials));
        const legacyConflict = normalized.find((camera, index) => Boolean(findCameraIpConflict(normalized.slice(0, index), camera.cameraHost ?? "")));
        if (!disposed) {
          servicePidRef.current = status.pid;
          setServiceStatus(status);
          setCredentialMetadata(credentials);
          setCameras(normalized);
          setActiveCamId(normalized[0]?.id ?? null);
          setHydratedFromStorage(true);
          if (legacyConflict) {
            setConfigurationError(`${CAMERA_IP_CONFLICT_MESSAGE} Existing entries were left unchanged for review.`);
          }
        }
      } catch (error) {
        if (!disposed) {
          setCameras([]);
          setCredentialMetadata({});
          setActiveCamId(null);
          setServiceError(toErrorMessage(error));
        }
      }
    };

    void hydrateCameras();
    return () => {
      disposed = true;
    };
  }, [setCameras, storageKey]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    void replaceLocalCameras(mlBaseUrl, cameras.map(redactCameraForStorage))
      .then(() => setConfigurationError(null))
      .catch((error: unknown) => setConfigurationError(toErrorMessage(error)));
  }, [cameras, hydratedFromStorage, mlBaseUrl]);

  useEffect(() => {
    if (activeCamId !== null && cameras.some((camera) => camera.id === activeCamId)) return;
    setActiveCamId(cameras[0]?.id ?? null);
  }, [activeCamId, cameras]);

  useEffect(() => {
    if (activeCam && !isEditMode) setEditForm({ ...structuredClone(activeCam), password: undefined });
  }, [activeCam, isEditMode]);

  useEffect(() => {
    const connection = createReconnectingWebSocket({
      url: getMlCameraWebSocketUrl(mlBaseUrl),
      onOpen: () => {
        setIsMlLiveConnected(true);
      },
      onMessage: (event) => {
        try {
          const envelope = JSON.parse(event.data) as MlCameraLiveEnvelope;
          if (envelope.type === "camera.states") applyCameraStates(envelope.data);
        } catch {
          // Ignore malformed local service messages and wait for the next state frame.
        }
      },
      onClose: () => {
        setIsMlLiveConnected(false);
      },
    });

    return () => {
      setIsMlLiveConnected(false);
      connection.dispose();
    };
  }, [applyCameraStates, mlBaseUrl]);

  useEffect(() => {
    void refreshMlStatus();
    const intervalId = window.setInterval(() => void refreshMlStatus(), ML_STATUS_FALLBACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshMlStatus]);

  useEffect(() => {
    if (isMlLiveConnected) return undefined;
    const poller = createBackoffPoller({
      task: refreshCameraStates,
      successDelayMs: ML_STATES_FALLBACK_INTERVAL_MS,
      maxFailureDelayMs: 30_000,
    });
    return () => poller.dispose();
  }, [isMlLiveConnected, refreshCameraStates]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const expiredIds = Object.entries(cameraStartDeadlinesRef.current)
        .filter(([, deadline]) => now >= deadline)
        .map(([cameraId]) => Number(cameraId));
      if (expiredIds.length === 0) return;
      const expiredSet = new Set(expiredIds);
      for (const cameraId of expiredIds) delete cameraStartDeadlinesRef.current[cameraId];
      setCameraActions((current) => {
        const next = { ...current };
        for (const cameraId of expiredIds) delete next[cameraId];
        cameraActionsRef.current = next;
        return next;
      });
      setCameraErrors((current) => {
        const next = { ...current };
        for (const cameraId of expiredIds) next[cameraId] = CAMERA_START_SETTLE_TIMEOUT_MESSAGE;
        return next;
      });
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => (expiredSet.has(camera.id) ? { ...camera, status: "error" } : camera)));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [setCameras]);

  const handleSave = async () => {
    if (!editForm || !activeCam) return;
    const cameraId = editForm.id;
    if (cameraUpdateGateRef.current.isActive(cameraId)) return;
    if (editedCameraIpConflict) {
      setCameraError(cameraId, CAMERA_IP_CONFLICT_MESSAGE);
      document.getElementById("camera-ip-host")?.focus();
      return;
    }
    const replacementPassword = getCameraPasswordReplacement(editForm.password);
    const hasStoredPassword = Boolean(credentialMetadata[String(cameraId)]?.passwordConfigured);
    const nextCamera = canonicalizeCameraIp({
      ...editForm,
      password: undefined,
      username: editForm.username?.trim(),
    });
    const validationError = validateCamera(nextCamera, hasStoredPassword || Boolean(replacementPassword));
    if (validationError) {
      setCameraError(cameraId, validationError);
      return;
    }
    const connectionChanged = hasCameraConnectionChange(activeCam, nextCamera, Boolean(replacementPassword));
    const isRunning = cameraStates[cameraId]?.counts.running ?? isRuntimeStatus(activeCam.status);
    const runtimeAction = getCameraSaveRuntimeAction(activeCam, nextCamera, {
      isRunning,
      passwordChanged: Boolean(replacementPassword),
    });
    const countingConfigChanged = hasCameraCountingConfigChange(activeCam, nextCamera);
    const restartRequired = hasCameraRestartRequiredChange(activeCam, nextCamera, Boolean(replacementPassword));
    const shouldRestart = runtimeAction === "restart";
    const shouldUpdateCounting = countingConfigChanged && !restartRequired;
    const credentialChanged = activeCam.username !== nextCamera.username || Boolean(replacementPassword);
    const savedCamera: Camera = { ...nextCamera, status: isRunning ? nextCamera.status : connectionChanged ? "untested" : nextCamera.status };
    const savedCameras = cameras.map((camera) => (camera.id === cameraId ? savedCamera : camera));
    if (!cameraUpdateGateRef.current.begin(cameraId)) return;
    setCameraAction(cameraId, "saving");
    try {
      if (credentialChanged) {
        const metadata = await saveCameraCredential(storageKey, savedCamera.id, {
          password: replacementPassword,
          username: savedCamera.username ?? "",
        });
        setCredentialMetadata((current) => ({
          ...current,
          [String(savedCamera.id)]: metadata,
        }));
      }
      if (shouldUpdateCounting) {
        const acknowledgement = await updateCameraCountingConfig(mlBaseUrl, savedCamera, { requireActiveWorker: isRunning });
        if (!acknowledgement.persisted) {
          throw new MlServiceRequestError("tripwire_persistence_failed", "The Tripwire configuration was not persisted.");
        }
        if (isRunning && !acknowledgement.worker_applied) {
          throw new MlServiceRequestError("tripwire_worker_update_failed", "The active camera worker did not acknowledge the Tripwire update.");
        }
      } else {
        await replaceLocalCameras(mlBaseUrl, savedCameras.map(redactCameraForStorage));
      }
      setCameras((current) => current.map((camera) => (camera.id === cameraId ? (shouldUpdateCounting ? mergeConfirmedCameraCountingConfig(camera, savedCamera.config) : savedCamera) : camera)));
      setCameraError(savedCamera.id, null);
      if (!shouldRestart) {
        notifySuccess(shouldUpdateCounting ? "Tripwire configuration saved" : "Camera configuration updated.");
      }
    } catch (error) {
      setCameraAction(cameraId);
      const message = shouldUpdateCounting ? getTripwireSaveErrorMessage(error) : toErrorMessage(error);
      if (shouldUpdateCounting) {
        setEditForm((current) => (current?.id === cameraId ? { ...current, config: structuredClone(activeCam.config) } : current));
      }
      setCameraError(savedCamera.id, message);
      notifyError(message);
      cameraUpdateGateRef.current.end(cameraId);
      return;
    }

    if (!shouldRestart) {
      setCameraAction(cameraId);
      cameraUpdateGateRef.current.end(cameraId);
      if (activeCamIdRef.current === cameraId) setIsEditMode(false);
      return;
    }

    beginCameraStart(savedCamera.id);
    try {
      await startCameraProcessing(mlBaseUrl, savedCamera, storageKey);
      setCameraAction(savedCamera.id, "starting");
      void refreshCameraStates().catch(() => undefined);
      if (activeCamIdRef.current === cameraId) setIsEditMode(false);
    } catch (error) {
      const remainsPending = handleCameraStartFailure(savedCamera.id, error);
      if (remainsPending) {
        void refreshCameraStates().catch(() => undefined);
        if (activeCamIdRef.current === cameraId) setIsEditMode(false);
      }
    } finally {
      cameraUpdateGateRef.current.end(cameraId);
    }
  };

  const handleAddCamera = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasReachedCameraConfigurationLimit(cameras.length, configuredCameraLimit)) {
      const message = cameraConfigurationLimitMessage(configuredCameraLimit);
      setConfigurationError(message);
      notifyError(message);
      setShowAddModal(false);
      return;
    }
    const errors = validateCameraForm(newCam);
    if (newCameraIpConflict) errors.cameraHost = CAMERA_IP_CONFLICT_MESSAGE;
    setCameraFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      if (errors.cameraHost) document.getElementById("camera-ip-host")?.focus();
      return;
    }
    setIsValidating(true);
    const newCameraNode: Camera = canonicalizeCameraIp({
      cameraHost: newCam.cameraHost || undefined,
      confidence: DEFAULT_COUNTING_CONFIDENCE,
      processingProfile: "auto",
      reidMode: "auto",
      trackingConfidence: DEFAULT_TRACKING_CONFIDENCE,
      uniqueCountingMode: "estimated_reid",
      config: { reverse: false, roi: DEFAULT_ROI, tripwire: 50, tripwires: getDefaultTripwires(50) },
      id: Date.now(),
      name: newCam.name.trim(),
      password: undefined,
      rtsp: newCam.rtsp.trim(),
      rtspStream: newCam.rtspStream,
      status: "untested",
      username: newCam.username.trim(),
      zone: newCam.zone.trim(),
    });
    try {
      const metadata = await saveCameraCredential(storageKey, newCameraNode.id, {
        password: newCam.password,
        username: newCam.username,
      });
      setCredentialMetadata((current) => ({
        ...current,
        [String(newCameraNode.id)]: metadata,
      }));
    } catch (error) {
      setCameraFormErrors({
        password: toErrorMessage(error),
      });
      setIsValidating(false);
      return;
    }
    setCameras((current) => [...current, newCameraNode]);
    setActiveCamId(newCameraNode.id);
    setNewCam(emptyCameraForm);
    setCameraFormErrors({});
    setCameraError(newCameraNode.id, null);
    setIsValidating(false);
    setShowAddModal(false);
  };

  const confirmDeleteCamera = async () => {
    if (!cameraPendingDelete) return;
    const cameraId = cameraPendingDelete.id;
    try {
      if (cameraStates[cameraId]?.counts.running) await stopCameraProcessing(mlBaseUrl, cameraId);
      await deleteCameraCredential(storageKey, cameraId);
      const updated = cameras.filter((camera) => camera.id !== cameraId);
      setCameras(updated);
      setCredentialMetadata((current) => {
        const next = { ...current };
        delete next[String(cameraId)];
        return next;
      });
      setCameraStates((current) => {
        const next = { ...current };
        delete next[cameraId];
        return next;
      });
      delete cameraStartDeadlinesRef.current[cameraId];
      delete cameraPreviewReadyRef.current[cameraId];
      setActiveCamId(updated[0]?.id ?? null);
      setIsEditMode(false);
      setCameraPendingDelete(null);
    } catch (error) {
      setCameraError(cameraId, toErrorMessage(error));
    }
  };

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
      if (handleCameraStartFailure(activeCam.id, error)) {
        void refreshCameraStates().catch(() => undefined);
      }
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
      servicePidRef.current = nextStatus.pid;
      setServiceStatus(nextStatus);
      setCameraStates({});
      setCameraActions({});
      cameraActionsRef.current = {};
      cameraStartDeadlinesRef.current = {};
      cameraPreviewReadyRef.current = {};
      setPendingCameraIds(new Set());
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => (isRuntimeStatus(camera.status) ? { ...camera, status: "stopped" } : camera)));
    } catch (error) {
      setServiceError(toErrorMessage(error));
    } finally {
      setIsRestartingService(false);
    }
  }, [setCameras]);

  const openAddModal = () => {
    if (hasReachedCameraConfigurationLimit(cameras.length, configuredCameraLimit)) {
      const message = cameraConfigurationLimitMessage(configuredCameraLimit);
      setConfigurationError(message);
      notifyError(message);
      return;
    }
    setCameraFormErrors({});
    setShowAddModal(true);
  };

  return {
    activeAction,
    activeCam,
    activeCamId,
    cameraFormErrors,
    cameraPendingDelete,
    configuredCameraLimit,
    confirmDeleteCamera,
    counts,
    credentialMetadata,
    detections,
    editedCameraIpConflict,
    editForm,
    handleAddCamera,
    handleRestartService,
    handleSave,
    handleStartProcessing,
    handleStopProcessing,
    handleTestConnection,
    health,
    isActiveCameraSaving,
    isActiveCameraStarting,
    isEditMode,
    isRestartingService,
    isValidating,
    monitoringError,
    newCam,
    newCameraIpConflict,
    openAddModal,
    serviceError,
    serviceStatus,
    setActiveCamId,
    setCameraFormErrors,
    setCameraPendingDelete,
    setEditForm,
    setIsEditMode,
    setNewCam,
    setShowAddModal,
    showAddModal,
    streamUrl,
    warnings,
  };
}
