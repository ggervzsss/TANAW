import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { Camera } from "../../../types/enterprise";
import type { CameraFormValues } from "../types/camera";
import { getValidationWarnings } from "../utils/camera-validation";
import { validateCameraForm, type CameraFormErrors } from "../utils/camera-form-validation";
import {
  isCameraPreviewReady,
} from "../utils/camera-live-state";
import { CAMERA_IP_CONFLICT_MESSAGE, canonicalizeCameraIp, findCameraIpConflict } from "../utils/camera-ip-uniqueness";
import { cameraConfigurationLimitMessage, DEFAULT_ENTERPRISE_CAMERA_LIMIT, hasReachedCameraConfigurationLimit } from "../utils/camera-capacity";
import { buildTapoRtspUrl } from "../utils/rtsp";
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
  getMlServiceStatus,
  getPreviewStreamUrl,
  listLocalCameras,
  replaceLocalCameras,
  startCameraProcessing,
  stopCameraProcessing,
  testCameraConnection,
  updateCameraCountingConfig,
} from "../services/ml-service";
import { MlServiceRequestError } from "../services/ml-service";
import { deleteCameraCredential, getCameraPasswordReplacement, loadCameraCredentialMetadata, saveCameraCredential, type CameraCredentialMetadataRecords } from "../services/camera-credentials";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { useCameraRuntimeController } from "./useCameraRuntimeController";

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
  getCameraStorageFingerprint,
  getDefaultTripwires,
  getTripwireSaveErrorMessage,
  isRuntimeStatus,
  isStartAction,
  normalizeCamera,
  redactCameraForStorage,
  toErrorMessage,
  validateCamera,
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

export function useCameraManagement({ cameras, setCameras, storageKey }: CameraManagementOptions) {
  const [activeCamId, setActiveCamId] = useState<number | null>(cameras[0]?.id ?? null);
  const activeCamIdRef = useRef(activeCamId);
  const cameraUpdateGateRef = useRef(createCameraUpdateGate());
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCam, setNewCam] = useState<CameraFormValues>(emptyCameraForm);
  const [cameraFormErrors, setCameraFormErrors] = useState<CameraFormErrors>({});
  const [isValidating, setIsValidating] = useState(false);
  const [editForm, setEditForm] = useState<Camera | null>(null);
  const [cameraPendingDelete, setCameraPendingDelete] = useState<Camera | null>(null);
  const [credentialMetadata, setCredentialMetadata] = useState<CameraCredentialMetadataRecords>({});
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const cameraProfilesForStorageRef = useRef<Camera[]>([]);
  const lastPersistedCameraFingerprintRef = useRef<string | null>(null);

  const activeCam = cameras.find((camera) => camera.id === activeCamId);
  const {
    adoptServiceStatus,
    beginCameraStart,
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
  } = useCameraRuntimeController({ activeCam, cameras, setCameras, storageKey });
  const activeState = activeCam ? cameraStates[activeCam.id] : undefined;
  const counts = activeState?.counts ?? EMPTY_ML_COUNTS;
  const detections = activeState?.detections ?? EMPTY_ML_DETECTIONS;
  const health = activeState?.health ?? serviceHealth;
  const activeAction = activeCam ? cameraActions[activeCam.id] : undefined;
  const isActiveCameraSaving = activeAction === "saving";
  const isActiveCameraStarting = Boolean(activeCam && (isStartAction(activeAction) || pendingCameraIds.has(activeCam.id)));
  const monitoringError = activeCam ? (activeState?.counts.error ?? cameraErrors[activeCam.id] ?? configurationError) : configurationError;
  const warnings = isEditMode && editForm ? getValidationWarnings(editForm.config) : getValidationWarnings(activeCam?.config);
  const streamVersion = activeCam ? (streamVersions[activeCam.id] ?? 0) : 0;
  const configuredCameraLimit = serviceHealth?.max_configured_cameras ?? DEFAULT_ENTERPRISE_CAMERA_LIMIT;
  const cameraStorageFingerprint = getCameraStorageFingerprint(cameras);
  cameraProfilesForStorageRef.current = cameras.map(redactCameraForStorage);
  const previewIsReady = !isActiveCameraStarting && isCameraPreviewReady(activeState);
  const streamUrl = useMemo(() => getPreviewStreamUrl(mlBaseUrl, activeCam, streamVersion, previewIsReady), [activeCam, mlBaseUrl, previewIsReady, streamVersion]);
  const newCameraIpConflict = useMemo(() => findCameraIpConflict(cameras, newCam.cameraHost), [cameras, newCam.cameraHost]);
  const editedCameraIpConflict = useMemo(() => (editForm ? findCameraIpConflict(cameras, editForm.cameraHost ?? "", editForm.id) : undefined), [cameras, editForm]);

  useEffect(() => {
    activeCamIdRef.current = activeCamId;
  }, [activeCamId]);
  useEffect(() => {
    let disposed = false;
    setHydratedFromStorage(false);
    setServiceError(null);
    setConfigurationError(null);
    resetRuntimeState();
    setCredentialMetadata({});
    lastPersistedCameraFingerprintRef.current = null;

    const hydrateCameras = async () => {
      try {
        const status = await getMlServiceStatus();
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const [saved, credentials] = await Promise.all([listLocalCameras(baseUrl), loadCameraCredentialMetadata(storageKey)]);
        const normalized = saved.map((camera) => applyStoredCameraMetadata(normalizeCamera(camera), credentials));
        const normalizedFingerprint = getCameraStorageFingerprint(normalized);
        const duplicateConflict = normalized.find((camera, index) => Boolean(findCameraIpConflict(normalized.slice(0, index), camera.cameraHost ?? "")));
        if (!disposed) {
          adoptServiceStatus(status);
          setCredentialMetadata(credentials);
          setCameras(normalized);
          lastPersistedCameraFingerprintRef.current = normalizedFingerprint;
          setActiveCamId(normalized[0]?.id ?? null);
          setHydratedFromStorage(true);
          if (duplicateConflict) {
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
  }, [adoptServiceStatus, resetRuntimeState, setCameras, setServiceError, storageKey]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (lastPersistedCameraFingerprintRef.current === cameraStorageFingerprint) return;
    const profiles = cameraProfilesForStorageRef.current;
    void replaceLocalCameras(mlBaseUrl, profiles)
      .then(() => {
        lastPersistedCameraFingerprintRef.current = cameraStorageFingerprint;
        setConfigurationError(null);
      })
      .catch((error: unknown) => setConfigurationError(toErrorMessage(error)));
  }, [cameraStorageFingerprint, hydratedFromStorage, mlBaseUrl]);

  useEffect(() => {
    if (activeCamId !== null && cameras.some((camera) => camera.id === activeCamId)) return;
    setActiveCamId(cameras[0]?.id ?? null);
  }, [activeCamId, cameras]);

  useEffect(() => {
    if (activeCam && !isEditMode) setEditForm({ ...structuredClone(activeCam), password: undefined });
  }, [activeCam, isEditMode]);

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
      lastPersistedCameraFingerprintRef.current = getCameraStorageFingerprint(savedCameras);
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
      rtsp: buildTapoRtspUrl(newCam.cameraHost, "stream2"),
      rtspStream: "stream2",
      status: "untested",
      username: newCam.username.trim(),
      zone: newCam.zone.trim(),
    });
    let metadata: Awaited<ReturnType<typeof saveCameraCredential>>;
    try {
      metadata = await saveCameraCredential(storageKey, newCameraNode.id, {
        password: newCam.password,
        username: newCam.username,
      });
    } catch (error) {
      setCameraFormErrors({
        password: toErrorMessage(error),
      });
      setIsValidating(false);
      return;
    }

    try {
      const result = await testCameraConnection(mlBaseUrl, newCameraNode, storageKey);
      if (!result.ok) throw new Error(result.message);
    } catch (error) {
      try {
        await deleteCameraCredential(storageKey, newCameraNode.id);
      } catch {
        // The connection error remains the actionable failure for the user.
      }
      setCameraFormErrors({ rtsp: toErrorMessage(error) });
      setIsValidating(false);
      return;
    }

    setCredentialMetadata((current) => ({
      ...current,
      [String(newCameraNode.id)]: metadata,
    }));
    const verifiedCameraNode: Camera = { ...newCameraNode, status: "online" };
    setCameras((current) => [...current, verifiedCameraNode]);
    setActiveCamId(verifiedCameraNode.id);
    setNewCam(emptyCameraForm);
    setCameraFormErrors({});
    setCameraError(verifiedCameraNode.id, null);
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
      removeCameraRuntimeState(cameraId);
      setActiveCamId(updated[0]?.id ?? null);
      setIsEditMode(false);
      setCameraPendingDelete(null);
    } catch (error) {
      setCameraError(cameraId, toErrorMessage(error));
    }
  };

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
