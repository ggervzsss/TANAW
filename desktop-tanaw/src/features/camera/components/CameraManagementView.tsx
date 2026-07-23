import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmationDialog } from "../../../components/ConfirmationDialog";
import type { Camera, CameraStatus } from "../../../types/enterprise";
import { validateCameraStreamUrl } from "../../../utils/form-validation";
import { createBackoffPoller } from "../../../utils/backoff-poller";
import { createReconnectingWebSocket } from "../../../utils/reconnecting-websocket";
import { CameraAddModal } from "./CameraAddModal";
import { CameraList } from "./CameraList";
import { CameraPreviewPanel } from "./CameraPreviewPanel";
import type { CameraFormValues } from "../types/camera";
import { getValidationWarnings } from "../utils/camera-validation";
import { validateCameraForm, type CameraFormErrors } from "../utils/camera-form-validation";
import { cameraStatusFromRuntime, clearRecoveredCameraRequestErrors, isAcceptedCameraStartSettled, mergeCameraStates } from "../utils/camera-live-state";
import { buildTapoRtspUrl, isValidIpv4, maskStreamCredentials, parseRtspConnection, stripStreamCredentials } from "../utils/rtsp";
import { CAMERA_IP_CONFLICT_MESSAGE, canonicalizeCameraIp, findCameraIpConflict } from "../utils/camera-ip-uniqueness";
import { createTripwireLine, normalizeTripwireLine } from "../utils/tripwire-path";
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
} from "../services/ml-service";
import type { MlCameraLiveEnvelope, MlCameraLiveState, MlCameraStates, MlHealth, MlServiceStatus } from "../services/ml-service";
import { deleteCameraCredential, loadCameraCredentialMetadata, saveCameraCredential, type CameraCredentialMetadataRecords } from "../services/camera-credentials";

type CameraManagementViewProps = {
  cameras: Camera[];
  setCameras: React.Dispatch<React.SetStateAction<Camera[]>>;
  storageKey: string;
};

type CameraAction = "requesting-start" | "starting" | "stopping" | "testing";

const emptyCameraForm: CameraFormValues = {
  cameraHost: "",
  name: "",
  password: "",
  rtsp: "",
  rtspStream: "stream2",
  username: "",
  zone: "",
};

const DEFAULT_COUNTING_CONFIDENCE = 0.35;
const DEFAULT_TRACKING_CONFIDENCE = 0.15;
const DEFAULT_ROI: Camera["config"]["roi"] = { top: 0, left: 0, width: 100, height: 100 };
const PREVIOUS_DEFAULT_ROI: Camera["config"]["roi"] = { top: 10, left: 10, width: 80, height: 80 };
const ML_STATUS_FALLBACK_INTERVAL_MS = 10_000;
const ML_STATES_FALLBACK_INTERVAL_MS = 2_500;

export function CameraManagementView({ cameras, setCameras, storageKey }: CameraManagementViewProps) {
  const [activeCamId, setActiveCamId] = useState<number | null>(cameras[0]?.id ?? null);
  const [cameraStates, setCameraStates] = useState<Record<number, MlCameraLiveState>>({});
  const [cameraErrors, setCameraErrors] = useState<Record<number, string | null>>({});
  const [cameraActions, setCameraActions] = useState<Record<number, CameraAction | undefined>>({});
  const cameraActionsRef = useRef(cameraActions);
  cameraActionsRef.current = cameraActions;
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
  const isActiveCameraStarting = Boolean(activeCam && (isStartAction(activeAction) || pendingCameraIds.has(activeCam.id)));
  const monitoringError = activeCam ? (activeState?.counts.error ?? cameraErrors[activeCam.id] ?? configurationError ?? serviceError) : (configurationError ?? serviceError);
  const warnings = isEditMode && editForm ? getValidationWarnings(editForm.config) : getValidationWarnings(activeCam?.config);
  const mlBaseUrl = serviceStatus?.baseUrl ?? DEFAULT_ML_SERVICE_BASE_URL;
  const streamVersion = activeCam ? (streamVersions[activeCam.id] ?? 0) : 0;
  const streamUrl = useMemo(() => getPreviewStreamUrl(mlBaseUrl, activeCam, streamVersion, Boolean(activeState?.counts.running)), [activeCam, activeState?.counts.running, mlBaseUrl, streamVersion]);
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
    setCameraActions((current) => ({ ...current, [cameraId]: action }));
  }, []);

  const bumpStreamVersion = useCallback((cameraId: number) => {
    setStreamVersions((current) => ({ ...current, [cameraId]: (current[cameraId] ?? 0) + 1 }));
  }, []);

  const applyCameraStates = useCallback(
    (payload: MlCameraStates) => {
      const registeredCameraIds = activeCameraIdsRef.current;
      const nextStates = payload.cameras.filter((state) => registeredCameraIds.has(state.camera_id));
      setPendingCameraIds(new Set(payload.pending_camera_ids.filter((cameraId) => registeredCameraIds.has(cameraId))));
      setCameraStates((current) => mergeCameraStates(current, payload, registeredCameraIds));
      setCameraErrors((current) => clearRecoveredCameraRequestErrors(current, nextStates));
      setCameraActions((current) => {
        let changed = false;
        const next = { ...current };
        for (const [cameraIdText, action] of Object.entries(current)) {
          const cameraId = Number(cameraIdText);
          if (action === "starting" && isAcceptedCameraStartSettled(payload, cameraId)) {
            delete next[cameraId];
            changed = true;
          }
        }
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
          const acceptedStartIsPending = payload.pending_camera_ids.includes(camera.id) || (isStartAction(cameraActionsRef.current[camera.id]) && !isAcceptedCameraStartSettled(payload, camera.id));
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

  const handleSave = async () => {
    if (!editForm || !activeCam) return;
    if (editedCameraIpConflict) {
      setCameraError(editForm.id, CAMERA_IP_CONFLICT_MESSAGE);
      document.getElementById("camera-ip-host")?.focus();
      return;
    }
    const replacementPassword = editForm.password?.trim() ? editForm.password : undefined;
    const hasStoredPassword = Boolean(credentialMetadata[String(editForm.id)]?.passwordConfigured);
    const nextCamera = canonicalizeCameraIp({
      ...editForm,
      password: undefined,
      username: editForm.username?.trim(),
    });
    const validationError = validateCamera(nextCamera, hasStoredPassword || Boolean(replacementPassword));
    if (validationError) {
      setCameraError(editForm.id, validationError);
      return;
    }
    const connectionChanged =
      activeCam.rtsp !== nextCamera.rtsp ||
      activeCam.cameraHost !== nextCamera.cameraHost ||
      activeCam.rtspStream !== nextCamera.rtspStream ||
      activeCam.username !== nextCamera.username ||
      Boolean(replacementPassword);
    const isRunning = Boolean(cameraStates[editForm.id]?.counts.running);
    const savedCamera: Camera = { ...nextCamera, status: isRunning ? nextCamera.status : connectionChanged ? "untested" : nextCamera.status };
    try {
      const metadata = await saveCameraCredential(storageKey, savedCamera.id, {
        password: replacementPassword,
        username: savedCamera.username ?? "",
      });
      setCredentialMetadata((current) => ({
        ...current,
        [String(savedCamera.id)]: metadata,
      }));
      setCameras((current) => current.map((camera) => (camera.id === activeCamId ? savedCamera : camera)));
      setCameraError(savedCamera.id, null);
    } catch (error) {
      setCameraError(savedCamera.id, toErrorMessage(error));
      return;
    }

    if (!isRunning) {
      setIsEditMode(false);
      return;
    }

    setCameraAction(savedCamera.id, "requesting-start");
    try {
      await startCameraProcessing(mlBaseUrl, savedCamera, storageKey);
      setCameraAction(savedCamera.id, "starting");
      bumpStreamVersion(savedCamera.id);
      void refreshCameraStates().catch(() => undefined);
      setIsEditMode(false);
    } catch (error) {
      setCameraAction(savedCamera.id);
      updateCameraStatus(savedCamera.id, "error");
      setCameraError(savedCamera.id, toErrorMessage(error));
    }
  };

  const handleAddCamera = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      fps: 0,
      id: Date.now(),
      name: newCam.name.trim(),
      password: undefined,
      resolution: "Adaptive",
      rtsp: newCam.rtsp.trim(),
      rtspStream: newCam.rtspStream,
      status: "untested",
      type: "Entry/Exit",
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
    setCameraAction(activeCam.id, "requesting-start");
    setCameraError(activeCam.id, null);
    updateCameraStatus(activeCam.id, "starting");
    try {
      await startCameraProcessing(mlBaseUrl, activeCam, storageKey);
      setCameraAction(activeCam.id, "starting");
      bumpStreamVersion(activeCam.id);
      void refreshCameraStates().catch(() => undefined);
    } catch (error) {
      setCameraAction(activeCam.id);
      updateCameraStatus(activeCam.id, "error");
      setCameraError(activeCam.id, toErrorMessage(error));
    }
  }, [activeCam, bumpStreamVersion, mlBaseUrl, refreshCameraStates, setCameraAction, setCameraError, storageKey, updateCameraStatus]);

  const handleStopProcessing = useCallback(async () => {
    if (!activeCam) return;
    setCameraAction(activeCam.id, "stopping");
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
      setPendingCameraIds(new Set());
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => (isRuntimeStatus(camera.status) ? { ...camera, status: "stopped" } : camera)));
    } catch (error) {
      setServiceError(toErrorMessage(error));
    } finally {
      setIsRestartingService(false);
    }
  }, [setCameras]);

  const openAddModal = () => {
    setCameraFormErrors({});
    setShowAddModal(true);
  };

  return (
    <div className="animate-in fade-in flex h-full min-h-0 flex-col overflow-hidden font-['Inter'] duration-500">
      {showAddModal && (
        <CameraAddModal
          newCam={newCam}
          isValidating={isValidating}
          errors={cameraFormErrors}
          duplicateIpError={newCameraIpConflict ? CAMERA_IP_CONFLICT_MESSAGE : undefined}
          onClose={() => {
            setShowAddModal(false);
            setCameraFormErrors({});
          }}
          onSubmit={handleAddCamera}
          onChange={(values) => {
            setNewCam(values);
            setCameraFormErrors({});
          }}
        />
      )}
      {cameraPendingDelete && (
        <ConfirmationDialog
          cancelLabel="Keep Camera"
          confirmLabel="Delete Camera"
          onCancel={() => setCameraPendingDelete(null)}
          onConfirm={() => void confirmDeleteCamera()}
          title="Delete Camera"
          variant="danger"
        >
          <p>
            Are you sure you want to delete <span className="font-bold text-[#111827] dark:text-white">{cameraPendingDelete.name}</span>? This will stop visitor counting from this camera.
          </p>
        </ConfirmationDialog>
      )}

      <div className="mb-3 shrink-0">
        <h2 className="truncate text-xl font-bold tracking-tight text-[#111827] dark:text-white">Camera Setup</h2>
        <p className="truncate text-xs font-medium text-gray-500 dark:text-slate-400">Local CCTV stream verification, AI counting, and tripwire calibration.</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,240px)_minmax(0,1fr)] gap-4 max-lg:grid-cols-[minmax(190px,220px)_minmax(0,1fr)]">
        <div className="min-h-0 flex-1">
          <CameraList
            cameras={cameras}
            activeCamId={activeCamId}
            onAdd={openAddModal}
            onSelect={(cameraId) => {
              setActiveCamId(cameraId);
              setIsEditMode(false);
            }}
          />
        </div>
        <div className="min-h-0">
          <CameraPreviewPanel
            activeCam={activeCam}
            cameraIpError={editedCameraIpConflict ? CAMERA_IP_CONFLICT_MESSAGE : undefined}
            counts={counts}
            detections={detections}
            editForm={editForm}
            error={monitoringError}
            hasStoredPassword={Boolean(activeCam && credentialMetadata[String(activeCam.id)]?.passwordConfigured)}
            health={health}
            isRestartingService={isRestartingService}
            isEditMode={isEditMode}
            isStarting={isActiveCameraStarting}
            isStopping={activeAction === "stopping"}
            isTesting={activeAction === "testing"}
            serviceStatus={serviceStatus}
            streamUrl={streamUrl}
            warnings={warnings}
            onCancelEdit={() => setIsEditMode(false)}
            onDelete={() => activeCam && setCameraPendingDelete(activeCam)}
            onEdit={() => setIsEditMode(true)}
            onEditFormChange={setEditForm}
            onRestartService={handleRestartService}
            onSave={() => void handleSave()}
            onStartProcessing={() => void handleStartProcessing()}
            onStopProcessing={() => void handleStopProcessing()}
            onTestConnection={() => void handleTestConnection()}
          />
        </div>
      </div>
    </div>
  );
}

function isRuntimeStatus(status: CameraStatus) {
  return status === "starting" || status === "connecting" || status === "running" || status === "degraded" || status === "reconnecting";
}

function isStartAction(action: CameraAction | undefined) {
  return action === "requesting-start" || action === "starting";
}

function validateCamera(camera: Camera, hasStoredPassword: boolean) {
  if (!isValidIpv4(camera.cameraHost ?? "")) return "Camera IP must be a valid IPv4 address.";
  if (!camera.username?.trim()) return "Enter the camera username.";
  if (!hasStoredPassword) return "Enter the camera password.";
  const streamError = validateCameraStreamUrl(camera.rtsp);
  if (streamError) return streamError;
  if (!Number.isFinite(camera.confidence) || camera.confidence < 0.05 || camera.confidence > 0.95) return "Counting confidence must be between 0.05 and 0.95.";
  if (!Number.isFinite(camera.trackingConfidence ?? 0.15) || (camera.trackingConfidence ?? 0.15) < 0.01 || (camera.trackingConfidence ?? 0.15) > camera.confidence)
    return "Tracking confidence must be between 0.01 and the counting confidence.";
  return null;
}

function updateCamerasWhenChanged(cameras: Camera[], updateCamera: (camera: Camera) => Camera) {
  let changed = false;
  const updated = cameras.map((camera) => {
    const nextCamera = updateCamera(camera);
    if (nextCamera !== camera) changed = true;
    return nextCamera;
  });
  return changed ? updated : cameras;
}

function normalizeCamera(camera: Camera): Camera {
  const streamUrl = camera.rtsp ?? "";
  const parsedRtsp = parseRtspConnection(streamUrl);
  const cameraHost = camera.cameraHost ?? parsedRtsp.host;
  const rtspStream = camera.rtspStream ?? parsedRtsp.streamId;
  const normalizedStreamUrl = buildTapoRtspUrl(cameraHost, rtspStream) || stripStreamCredentials(streamUrl);
  const tripwire = camera.config?.tripwire ?? 50;
  const confidence = camera.confidence ?? DEFAULT_COUNTING_CONFIDENCE;
  const rawTrackingConfidence = camera.trackingConfidence ?? DEFAULT_TRACKING_CONFIDENCE;
  return {
    ...camera,
    cameraHost: cameraHost || undefined,
    confidence,
    reidMode: normalizeReIdMode(camera.reidMode),
    trackingConfidence: Math.max(0.01, Math.min(rawTrackingConfidence, confidence)),
    uniqueCountingMode: normalizeUniqueCountingMode(camera.uniqueCountingMode),
    password: undefined,
    processingProfile: normalizeProcessingProfile(camera.processingProfile),
    fps: camera.fps ?? 0,
    resolution: camera.resolution ?? "Adaptive",
    rtsp: maskStreamCredentials(normalizedStreamUrl),
    rtspStream,
    status: camera.status && isRuntimeStatus(camera.status) ? "stopped" : (camera.status ?? "untested"),
    username: normalizeOptionalCredential(camera.username),
    config: {
      ...camera.config,
      tripwire,
      tripwires: camera.config?.tripwires ? { entry: normalizeTripwireLine(camera.config.tripwires.entry), exit: normalizeTripwireLine(camera.config.tripwires.exit) } : getDefaultTripwires(tripwire),
      roi: normalizeRoi(camera.config?.roi),
      reverse: camera.config?.reverse ?? false,
    },
  };
}

function normalizeRoi(roi: Camera["config"]["roi"] | undefined): Camera["config"]["roi"] {
  if (!roi || sameRoi(roi, PREVIOUS_DEFAULT_ROI)) return DEFAULT_ROI;
  const normalized = { top: clampPercent(roi.top), left: clampPercent(roi.left), width: clampPercent(roi.width), height: clampPercent(roi.height) };
  if (normalized.left + normalized.width > 100) normalized.width = Math.max(0, 100 - normalized.left);
  if (normalized.top + normalized.height > 100) normalized.height = Math.max(0, 100 - normalized.top);
  return normalized;
}

function sameRoi(left: Camera["config"]["roi"], right: Camera["config"]["roi"]) {
  return left.top === right.top && left.left === right.left && left.width === right.width && left.height === right.height;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function normalizeReIdMode(mode: unknown): Camera["reidMode"] {
  return mode === "auto" || mode === "off" || mode === "fast" || mode === "quality" ? mode : "auto";
}

function normalizeUniqueCountingMode(mode: unknown): Camera["uniqueCountingMode"] {
  return mode === "entry_only" || mode === "estimated_reid" ? mode : "estimated_reid";
}

function redactCameraForStorage(camera: Camera): Camera {
  return {
    ...camera,
    password: undefined,
    rtsp: stripStreamCredentials(camera.rtsp),
    status:
      camera.status === "starting" || camera.status === "connecting" || camera.status === "degraded" || camera.status === "reconnecting"
        ? "running"
        : camera.status === "failed"
          ? "error"
          : camera.status,
    username: undefined,
  };
}

function applyStoredCameraMetadata(camera: Camera, credentials: CameraCredentialMetadataRecords): Camera {
  const record = credentials[String(camera.id)];
  if (!record) return camera;
  return {
    ...camera,
    password: undefined,
    username: normalizeOptionalCredential(record.username) ?? camera.username,
  };
}

function normalizeOptionalCredential(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeProcessingProfile(profile: unknown): Camera["processingProfile"] {
  return profile === "auto" || profile === "compatibility" || profile === "balanced" || profile === "high_accuracy" || profile === "emergency" ? profile : "auto";
}

function getDefaultTripwires(centerX: number) {
  return {
    entry: createTripwireLine([
      { x: Math.max(5, centerX - 8), y: 12 },
      { x: Math.max(5, centerX - 8), y: 88 },
    ]),
    exit: createTripwireLine([
      { x: Math.min(95, centerX + 8), y: 12 },
      { x: Math.min(95, centerX + 8), y: 88 },
    ]),
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The ML camera service request failed.";
}
