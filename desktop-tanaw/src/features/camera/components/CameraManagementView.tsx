import type { Dispatch, SetStateAction } from "react";
import { ConfirmationDialog } from "../../../components/ConfirmationDialog";
import type { Camera } from "../../../types/enterprise";
import { CAMERA_IP_CONFLICT_MESSAGE } from "../utils/camera-ip-uniqueness";
import { useCameraManagement } from "../hooks/useCameraManagement";
import { CameraAddModal } from "./CameraAddModal";
import { CameraList } from "./CameraList";
import { CameraPreviewPanel } from "./CameraPreviewPanel";

type CameraManagementViewProps = {
  cameras: Camera[];
  setCameras: Dispatch<SetStateAction<Camera[]>>;
  storageKey: string;
};

export function CameraManagementView({ cameras, setCameras, storageKey }: CameraManagementViewProps) {
  const {
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
  } = useCameraManagement({ cameras, setCameras, storageKey });

  return (
    <div className="animate-in fade-in flex h-full min-h-0 flex-col overflow-hidden font-sans duration-500">
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
            cameraLimit={configuredCameraLimit}
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
            isSaving={isActiveCameraSaving}
            isStarting={isActiveCameraStarting}
            isStopping={activeAction === "stopping"}
            isTesting={activeAction === "testing"}
            serviceStatus={serviceStatus}
            serviceError={serviceError}
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
