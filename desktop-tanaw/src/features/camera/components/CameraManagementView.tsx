import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmationDialog } from "../../../components/ConfirmationDialog";
import type { Camera } from "../../../types/enterprise";
import { validateCameraStreamUrl, validateRequiredText } from "../../../utils/form-validation";
import { CameraAddModal } from "./CameraAddModal";
import { CameraList } from "./CameraList";
import { CameraPreviewPanel } from "./CameraPreviewPanel";
import type { CameraFormValues } from "../types/camera";
import { getValidationWarnings } from "../utils/camera-validation";
import { maskStreamCredentials } from "../utils/rtsp";
import { createTripwireLine, normalizeTripwireLine } from "../utils/tripwire-path";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  EMPTY_ML_COUNTS,
  EMPTY_ML_DETECTIONS,
  getMlCameraWebSocketUrl,
  getMlCounts,
  getMlDetections,
  getMlHealth,
  getMlSession,
  getPreviewStreamUrl,
  getMlServiceStatus,
  restartMlService,
  startCameraProcessing,
  stopCameraProcessing,
  testCameraConnection,
} from "../services/ml-service";
import type { MlCameraLiveEnvelope, MlCounts, MlDetections, MlHealth, MlServiceStatus, MlSession } from "../services/ml-service";
import { loadCameraCredentials, saveCameraCredentials, type CameraCredentialRecords } from "../services/camera-credentials";

type CameraManagementViewProps = {
  cameras: Camera[];
  setCameras: React.Dispatch<React.SetStateAction<Camera[]>>;
  storageKey: string;
};

const emptyCameraForm: CameraFormValues = {
  cameraType: "IP_WEBCAM",
  name: "",
  password: "",
  rtsp: "",
  username: "",
  zone: "",
};

const DEFAULT_COUNTING_CONFIDENCE = 0.35;
const DEFAULT_TRACKING_CONFIDENCE = 0.15;
const DEFAULT_ROI: Camera["config"]["roi"] = { top: 0, left: 0, width: 100, height: 100 };
const PREVIOUS_DEFAULT_ROI: Camera["config"]["roi"] = { top: 10, left: 10, width: 80, height: 80 };
const ML_STATUS_FALLBACK_INTERVAL_MS = 10_000;
const ML_SESSION_FALLBACK_INTERVAL_MS = 10_000;
const ML_COUNTS_FALLBACK_INTERVAL_MS = 5_000;
const ML_DETECTIONS_FALLBACK_INTERVAL_MS = 2_000;
const ML_LIVE_RECONNECT_MAX_DELAY_MS = 10_000;

type CameraFormErrors = Partial<Record<keyof CameraFormValues, string>>;

export function CameraManagementView({ cameras, setCameras, storageKey }: CameraManagementViewProps) {
  const [activeCamId, setActiveCamId] = useState<number | null>(cameras[0]?.id ?? null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCam, setNewCam] = useState<CameraFormValues>(emptyCameraForm);
  const [cameraFormErrors, setCameraFormErrors] = useState<CameraFormErrors>({});
  const [isValidating, setIsValidating] = useState(false);
  const [editForm, setEditForm] = useState<Camera | null>(null);
  const [cameraPendingDelete, setCameraPendingDelete] = useState<Camera | null>(null);
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<MlServiceStatus | null>(null);
  const [health, setHealth] = useState<MlHealth | null>(null);
  const [counts, setCounts] = useState<MlCounts>(EMPTY_ML_COUNTS);
  const [detections, setDetections] = useState<MlDetections>(EMPTY_ML_DETECTIONS);
  const [processingCameraId, setProcessingCameraId] = useState<number | null>(null);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [isMlLiveConnected, setIsMlLiveConnected] = useState(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRestartingService, setIsRestartingService] = useState(false);

  const activeCam = cameras.find((camera) => camera.id === activeCamId);
  const activeCameraIds = useMemo(() => new Set(cameras.map((camera) => camera.id)), [cameras]);
  const warnings = isEditMode && editForm ? getValidationWarnings(editForm.config) : getValidationWarnings(activeCam?.config);
  const mlBaseUrl = serviceStatus?.baseUrl ?? DEFAULT_ML_SERVICE_BASE_URL;
  const isProcessingActiveCamera = Boolean(activeCam && processingCameraId === activeCam.id && counts.running);
  const streamUrl = useMemo(() => getPreviewStreamUrl(mlBaseUrl, activeCam, streamVersion, isProcessingActiveCamera), [activeCam, isProcessingActiveCamera, mlBaseUrl, streamVersion]);

  const updateCameraStatus = useCallback(
    (cameraId: number, status: Camera["status"]) => {
      setCameras((current) => current.map((camera) => (camera.id === cameraId ? { ...camera, status } : camera)));
    },
    [setCameras],
  );

  const refreshMlStatus = useCallback(async () => {
    const nextStatus = await getMlServiceStatus();
    setServiceStatus(nextStatus);

    try {
      const nextHealth = await getMlHealth(nextStatus.baseUrl);
      setHealth(nextHealth);
    } catch (error) {
      setHealth(null);
      setMonitoringError(toErrorMessage(error));
    }
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const nextCounts = await getMlCounts(mlBaseUrl);
      if (nextCounts.running && processingCameraId !== null && !activeCameraIds.has(processingCameraId)) {
        setCounts(EMPTY_ML_COUNTS);
        setDetections(EMPTY_ML_DETECTIONS);
        return;
      }

      setCounts(nextCounts);

      if (!nextCounts.running) {
        setProcessingCameraId(null);
        setDetections(EMPTY_ML_DETECTIONS);
        setCameras((current) => current.map((camera) => (camera.status === "running" ? { ...camera, status: nextCounts.status === "error" ? "error" : "stopped" } : camera)));
      }
    } catch {
      setCounts((current) => ({ ...current, running: false, status: "offline" }));
    }
  }, [activeCameraIds, mlBaseUrl, processingCameraId, setCameras]);

  const applyMlSession = useCallback(
    async (session: MlSession) => {
      setCounts(session.counts);

      if (session.running && session.camera_id !== null) {
        if (!activeCameraIds.has(session.camera_id)) {
          try {
            await stopCameraProcessing(mlBaseUrl);
          } catch (error) {
            setMonitoringError(toErrorMessage(error));
            return false;
          }
          setProcessingCameraId(null);
          setCounts(EMPTY_ML_COUNTS);
          setDetections(EMPTY_ML_DETECTIONS);
          setCameras((current) => current.map((camera) => (camera.status === "running" ? { ...camera, status: "stopped" } : camera)));
          setMonitoringError("A running camera session from another enterprise was stopped to keep this account's CCTV setup isolated.");
          return false;
        }

        setProcessingCameraId(session.camera_id);
        setCameras((current) => current.map((camera) => (camera.id === session.camera_id && camera.status !== "running" ? { ...camera, status: "running" } : camera)));
        setActiveCamId((current) => current ?? session.camera_id);
        return true;
      }

      setProcessingCameraId(null);
      setDetections(EMPTY_ML_DETECTIONS);
      return false;
    },
    [activeCameraIds, mlBaseUrl, setCameras],
  );

  const refreshMlSession = useCallback(async () => {
    try {
      const session = await getMlSession(mlBaseUrl);
      await applyMlSession(session);
    } catch {
      // The regular health/count polling handles service-offline UI state.
    }
  }, [applyMlSession, mlBaseUrl]);

  const refreshDetections = useCallback(async () => {
    if (!processingCameraId || !counts.running) {
      setDetections(EMPTY_ML_DETECTIONS);
      return;
    }

    try {
      setDetections(await getMlDetections(mlBaseUrl));
    } catch {
      setDetections((current) => ({ ...current, running: false, status: "offline", tracks: [] }));
    }
  }, [counts.running, mlBaseUrl, processingCameraId]);

  const handleMlLiveEnvelope = useCallback(
    (rawData: string) => {
      let envelope: MlCameraLiveEnvelope;
      try {
        envelope = JSON.parse(rawData) as MlCameraLiveEnvelope;
      } catch {
        return;
      }

      if (envelope.type !== "camera.state") return;

      const { detections: nextDetections, health: nextHealth, session } = envelope.data;
      setHealth(nextHealth);
      void applyMlSession(session);

      if (session.running && session.camera_id !== null && activeCameraIds.has(session.camera_id)) {
        setDetections(nextDetections);
        return;
      }

      setDetections(EMPTY_ML_DETECTIONS);
    },
    [activeCameraIds, applyMlSession],
  );

  useEffect(() => {
    let disposed = false;
    setHydratedFromStorage(false);
    setMonitoringError(null);
    setProcessingCameraId(null);
    setCounts(EMPTY_ML_COUNTS);
    setDetections(EMPTY_ML_DETECTIONS);

    const hydrateCameras = async () => {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) {
        if (!disposed) {
          setCameras([]);
          setActiveCamId(null);
          setHydratedFromStorage(true);
        }
        return;
      }

      try {
        const parsed = JSON.parse(saved) as Camera[];
        const credentials = await loadCameraCredentials(storageKey);
        const normalized = parsed.map((camera) => applyStoredCameraCredentials(normalizeCamera(camera), credentials));
        if (!disposed) {
          setCameras(normalized);
          setActiveCamId(normalized[0]?.id ?? null);
        }
      } catch {
        window.localStorage.removeItem(storageKey);
        if (!disposed) {
          setCameras([]);
          setActiveCamId(null);
        }
      } finally {
        if (!disposed) {
          setHydratedFromStorage(true);
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
    window.localStorage.setItem(storageKey, JSON.stringify(cameras.map(redactCameraForStorage)));
    void saveCameraCredentials(storageKey, getCameraCredentialRecords(cameras));
  }, [cameras, hydratedFromStorage, storageKey]);

  useEffect(() => {
    if (activeCamId !== null && cameras.some((camera) => camera.id === activeCamId)) return;
    setActiveCamId(cameras[0]?.id ?? null);
  }, [activeCamId, cameras]);

  useEffect(() => {
    if (activeCam) {
      setEditForm(JSON.parse(JSON.stringify(activeCam)) as Camera);
    }
  }, [activeCam]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let closedByEffect = false;

    const scheduleReconnect = () => {
      if (closedByEffect) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, ML_LIVE_RECONNECT_MAX_DELAY_MS);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }

      try {
        socket = new WebSocket(getMlCameraWebSocketUrl(mlBaseUrl));
      } catch {
        setIsMlLiveConnected(false);
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        reconnectAttempt = 0;
        setIsMlLiveConnected(true);
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          handleMlLiveEnvelope(event.data);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        setIsMlLiveConnected(false);
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      setIsMlLiveConnected(false);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [handleMlLiveEnvelope, mlBaseUrl]);

  useEffect(() => {
    void refreshMlStatus();
    const intervalId = window.setInterval(() => void refreshMlStatus(), ML_STATUS_FALLBACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshMlStatus]);

  useEffect(() => {
    if (isMlLiveConnected) return undefined;

    void refreshMlSession();
    const intervalId = window.setInterval(() => void refreshMlSession(), ML_SESSION_FALLBACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isMlLiveConnected, refreshMlSession]);

  useEffect(() => {
    if (isMlLiveConnected) return undefined;

    void refreshCounts();
    const intervalId = window.setInterval(() => void refreshCounts(), ML_COUNTS_FALLBACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isMlLiveConnected, refreshCounts]);

  useEffect(() => {
    if (isMlLiveConnected) return undefined;

    void refreshDetections();
    const intervalId = window.setInterval(() => void refreshDetections(), ML_DETECTIONS_FALLBACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isMlLiveConnected, refreshDetections]);

  const handleDelete = () => {
    if (!activeCam) return;
    setCameraPendingDelete(activeCam);
  };

  const confirmDeleteCamera = () => {
    if (!cameraPendingDelete) return;

    const updated = cameras.filter((camera) => camera.id !== cameraPendingDelete.id);
    setCameras(updated);
    setActiveCamId(updated[0]?.id || null);
    setIsEditMode(false);
    setCameraPendingDelete(null);
  };

  const handleSave = async () => {
    if (!editForm || !activeCam) return;

    const rtspError = validateCameraStreamUrl(editForm.rtsp);
    if (rtspError) {
      setMonitoringError(rtspError);
      return;
    }

    if (!Number.isFinite(editForm.confidence) || editForm.confidence < 0.05 || editForm.confidence > 0.95) {
      setMonitoringError("Counting confidence must be between 0.05 and 0.95.");
      return;
    }
    if (!Number.isFinite(editForm.trackingConfidence ?? 0.15) || (editForm.trackingConfidence ?? 0.15) < 0.01 || (editForm.trackingConfidence ?? 0.15) > editForm.confidence) {
      setMonitoringError("Tracking confidence must be between 0.01 and the counting confidence.");
      return;
    }

    const connectionChanged = activeCam.rtsp !== editForm.rtsp || activeCam.cameraType !== editForm.cameraType || activeCam.username !== editForm.username || activeCam.password !== editForm.password;
    const isProcessingEditedCamera = processingCameraId === editForm.id && counts.running;
    const savedCamera: Camera = {
      ...editForm,
      status: isProcessingEditedCamera ? "running" : connectionChanged ? "untested" : editForm.status,
    };

    setCameras((current) =>
      current.map((camera) => {
        return camera.id === activeCamId ? savedCamera : camera;
      }),
    );
    setMonitoringError(null);

    if (!isProcessingEditedCamera) {
      setIsEditMode(false);
      return;
    }

    setIsStarting(true);
    try {
      await startCameraProcessing(mlBaseUrl, savedCamera);
      setProcessingCameraId(savedCamera.id);
      setCounts({ ...EMPTY_ML_COUNTS, running: true, status: "running" });
      setDetections(EMPTY_ML_DETECTIONS);
      setStreamVersion((current) => current + 1);
      await refreshMlStatus();
      await refreshCounts();
      setIsEditMode(false);
    } catch (error) {
      updateCameraStatus(savedCamera.id, "error");
      setMonitoringError(toErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  };

  const handleAddCamera = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateCameraForm(newCam);
    setCameraFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsValidating(true);

    const newCameraNode: Camera = {
      cameraType: newCam.cameraType,
      confidence: DEFAULT_COUNTING_CONFIDENCE,
      processingProfile: "auto",
      reidMode: "auto",
      trackingConfidence: DEFAULT_TRACKING_CONFIDENCE,
      uniqueCountingMode: "estimated_reid",
      config: {
        reverse: false,
        roi: DEFAULT_ROI,
        tripwire: 50,
        tripwires: getDefaultTripwires(50),
      },
      fps: 0,
      id: Date.now(),
      name: newCam.name.trim(),
      password: newCam.password || undefined,
      resolution: "Adaptive",
      rtsp: newCam.rtsp.trim(),
      status: "untested",
      type: "Entry/Exit",
      username: newCam.username.trim() || undefined,
      zone: newCam.zone.trim(),
    };

    setCameras((current) => [...current, newCameraNode]);
    setActiveCamId(newCameraNode.id);
    setNewCam(emptyCameraForm);
    setCameraFormErrors({});
    setMonitoringError(null);
    setIsValidating(false);
    setShowAddModal(false);
  };

  const handleNewCameraChange = (values: CameraFormValues) => {
    setNewCam(values);
    setCameraFormErrors({});
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setCameraFormErrors({});
  };

  const handleTestConnection = useCallback(async () => {
    if (!activeCam) return;

    setIsTesting(true);
    setMonitoringError(null);

    try {
      const result = await testCameraConnection(mlBaseUrl, activeCam);
      updateCameraStatus(activeCam.id, result.ok ? "online" : "offline");
      setMonitoringError(result.ok ? null : result.message);
      await refreshMlStatus();
    } catch (error) {
      updateCameraStatus(activeCam.id, "error");
      setMonitoringError(toErrorMessage(error));
    } finally {
      setIsTesting(false);
    }
  }, [activeCam, mlBaseUrl, refreshMlStatus, updateCameraStatus]);

  const handleStartProcessing = useCallback(async () => {
    if (!activeCam) return;

    setIsStarting(true);
    setMonitoringError(null);

    try {
      await startCameraProcessing(mlBaseUrl, activeCam);
      updateCameraStatus(activeCam.id, "running");
      setProcessingCameraId(activeCam.id);
      setCounts({ ...EMPTY_ML_COUNTS, running: true, status: "running" });
      setDetections(EMPTY_ML_DETECTIONS);
      setStreamVersion((current) => current + 1);
      await refreshMlStatus();
      await refreshCounts();
    } catch (error) {
      updateCameraStatus(activeCam.id, "error");
      setMonitoringError(toErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }, [activeCam, mlBaseUrl, refreshCounts, refreshMlStatus, updateCameraStatus]);

  const handleStopProcessing = useCallback(async () => {
    const cameraId = processingCameraId ?? activeCam?.id;
    if (!cameraId) return;

    setIsStopping(true);
    setMonitoringError(null);

    try {
      await stopCameraProcessing(mlBaseUrl);
      updateCameraStatus(cameraId, "stopped");
      setProcessingCameraId(null);
      setCounts(EMPTY_ML_COUNTS);
      setDetections(EMPTY_ML_DETECTIONS);
      setStreamVersion((current) => current + 1);
      await refreshMlStatus();
      await refreshCounts();
    } catch (error) {
      setMonitoringError(toErrorMessage(error));
    } finally {
      setIsStopping(false);
    }
  }, [activeCam?.id, mlBaseUrl, processingCameraId, refreshCounts, refreshMlStatus, updateCameraStatus]);

  const handleRestartService = useCallback(async () => {
    setIsRestartingService(true);
    setMonitoringError(null);

    try {
      const nextStatus = await restartMlService();
      setServiceStatus(nextStatus);
      setProcessingCameraId(null);
      setCounts(EMPTY_ML_COUNTS);
      setDetections(EMPTY_ML_DETECTIONS);
      setStreamVersion((current) => current + 1);
    } catch (error) {
      setMonitoringError(toErrorMessage(error));
    } finally {
      setIsRestartingService(false);
    }
  }, []);

  return (
    <div className="animate-in fade-in flex h-full min-h-0 flex-col overflow-hidden font-['Inter'] duration-500">
      {showAddModal && <CameraAddModal newCam={newCam} isValidating={isValidating} errors={cameraFormErrors} onClose={closeAddModal} onSubmit={handleAddCamera} onChange={handleNewCameraChange} />}
      {cameraPendingDelete && (
        <ConfirmationDialog
          cancelLabel="Keep Camera"
          confirmLabel="Delete Camera"
          onCancel={() => setCameraPendingDelete(null)}
          onConfirm={confirmDeleteCamera}
          title="Delete Camera Node"
          variant="danger"
        >
          <p>
            Are you sure you want to delete <span className="font-bold text-[#111827]">{cameraPendingDelete.name}</span>? This will stop all edge counting on this node.
          </p>
        </ConfirmationDialog>
      )}

      <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight text-[#111827]">Camera Setup</h2>
          <p className="truncate text-xs font-medium text-gray-500">Local CCTV stream verification, AI counting, and tripwire calibration.</p>
        </div>
        <button
          onClick={() => {
            setCameraFormErrors({});
            setShowAddModal(true);
          }}
          className="flex shrink-0 items-center gap-2 rounded-sm bg-[#065f46] px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#044a36]"
        >
          <Plus size={16} /> Add Camera Node
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,240px)_minmax(0,1fr)] gap-4 max-lg:grid-cols-[minmax(190px,220px)_minmax(0,1fr)]">
        <div className="min-h-0 flex-1">
          <CameraList
            cameras={cameras}
            activeCamId={activeCamId}
            onSelect={(cameraId) => {
              setActiveCamId(cameraId);
              setIsEditMode(false);
            }}
          />
        </div>

        <div className="min-h-0">
          <CameraPreviewPanel
            activeCam={activeCam}
            counts={counts}
            detections={detections}
            editForm={editForm}
            error={monitoringError}
            health={health}
            isRestartingService={isRestartingService}
            isEditMode={isEditMode}
            isStarting={isStarting}
            isStopping={isStopping}
            isTesting={isTesting}
            processingCameraId={processingCameraId}
            serviceStatus={serviceStatus}
            streamUrl={streamUrl}
            warnings={warnings}
            onCancelEdit={() => setIsEditMode(false)}
            onDelete={handleDelete}
            onEdit={() => setIsEditMode(true)}
            onEditFormChange={setEditForm}
            onRestartService={handleRestartService}
            onSave={handleSave}
            onStartProcessing={handleStartProcessing}
            onStopProcessing={handleStopProcessing}
            onTestConnection={handleTestConnection}
          />
        </div>
      </div>
    </div>
  );
}

function validateCameraForm(values: CameraFormValues) {
  const errors: CameraFormErrors = {};
  const nameError = validateRequiredText(values.name, "Camera name", 2);
  const zoneError = validateRequiredText(values.zone, "Assigned zone", 2);
  const streamError = validateCameraStreamUrl(values.rtsp);

  if (nameError) errors.name = nameError;
  if (zoneError) errors.zone = zoneError;
  if (streamError) errors.rtsp = streamError;
  return errors;
}

function normalizeCamera(camera: Camera): Camera {
  const streamUrl = camera.rtsp ?? "";
  const cameraType = camera.cameraType ?? (streamUrl.startsWith("http") ? "IP_WEBCAM" : "RTSP_CCTV");
  const tripwire = camera.config?.tripwire ?? 50;
  const confidence = camera.confidence ?? DEFAULT_COUNTING_CONFIDENCE;
  const rawTrackingConfidence = camera.trackingConfidence ?? DEFAULT_TRACKING_CONFIDENCE;
  const trackingConfidence = Math.max(0.01, Math.min(rawTrackingConfidence, confidence));

  return {
    ...camera,
    cameraType,
    confidence,
    reidMode: normalizeReIdMode(camera.reidMode),
    trackingConfidence,
    uniqueCountingMode: normalizeUniqueCountingMode(camera.uniqueCountingMode),
    password: normalizeOptionalCredential(camera.password),
    processingProfile: normalizeProcessingProfile(camera.processingProfile),
    fps: camera.fps ?? 0,
    resolution: camera.resolution ?? "Adaptive",
    rtsp: maskStreamCredentials(streamUrl),
    status: camera.status ?? "untested",
    username: normalizeOptionalCredential(camera.username),
    config: {
      ...camera.config,
      tripwire,
      tripwires: camera.config?.tripwires
        ? {
            entry: normalizeTripwireLine(camera.config.tripwires.entry),
            exit: normalizeTripwireLine(camera.config.tripwires.exit),
          }
        : getDefaultTripwires(tripwire),
      roi: normalizeRoi(camera.config?.roi),
      reverse: camera.config?.reverse ?? false,
    },
  };
}

function normalizeRoi(roi: Camera["config"]["roi"] | undefined): Camera["config"]["roi"] {
  if (!roi || sameRoi(roi, PREVIOUS_DEFAULT_ROI)) {
    return DEFAULT_ROI;
  }

  const normalized = {
    top: clampPercent(roi.top),
    left: clampPercent(roi.left),
    width: clampPercent(roi.width),
    height: clampPercent(roi.height),
  };

  if (normalized.left + normalized.width > 100) {
    normalized.width = Math.max(0, 100 - normalized.left);
  }
  if (normalized.top + normalized.height > 100) {
    normalized.height = Math.max(0, 100 - normalized.top);
  }

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
  if (mode === "auto" || mode === "off" || mode === "fast" || mode === "quality") {
    return mode;
  }
  return "auto";
}

function normalizeUniqueCountingMode(mode: unknown): Camera["uniqueCountingMode"] {
  if (mode === "entry_only" || mode === "estimated_reid") {
    return mode;
  }
  return "estimated_reid";
}

function redactCameraForStorage(camera: Camera): Camera {
  return {
    ...camera,
    password: undefined,
    rtsp: maskStreamCredentials(camera.rtsp),
    username: undefined,
  };
}

function applyStoredCameraCredentials(camera: Camera, credentials: CameraCredentialRecords): Camera {
  const record = credentials[String(camera.id)];
  if (!record) {
    return camera;
  }

  return {
    ...camera,
    password: normalizeOptionalCredential(record.password) ?? camera.password,
    username: normalizeOptionalCredential(record.username) ?? camera.username,
  };
}

function getCameraCredentialRecords(cameras: Camera[]): CameraCredentialRecords {
  const records: CameraCredentialRecords = {};
  for (const camera of cameras) {
    const username = normalizeOptionalCredential(camera.username);
    const password = normalizeOptionalCredential(camera.password);
    if (username || password) {
      records[String(camera.id)] = { password, username };
    }
  }
  return records;
}

function normalizeOptionalCredential(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeProcessingProfile(profile: unknown): Camera["processingProfile"] {
  if (
    profile === "auto" ||
    profile === "compatibility" ||
    profile === "balanced" ||
    profile === "high_accuracy" ||
    profile === "emergency"
  ) {
    return profile;
  }
  return "auto";
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
