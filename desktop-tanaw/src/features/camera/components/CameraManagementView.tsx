import { AnimatePresence } from "motion/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { CameraDialog } from "./CameraDialog";
import type { Camera } from "../../../types/enterprise";
import { CAMERA_IP_CONFLICT_MESSAGE } from "../utils/camera-ip-uniqueness";
import { clearEditedFieldErrors } from "../utils/camera-connection-errors";
import { useCameraManagement } from "../hooks/useCameraManagement";
import { CameraAddModal } from "./CameraAddModal";
import { useSkeletonReveal } from "../../../ui-kit";
import { CameraList } from "./CameraList";
import { CameraPreviewPanel } from "./CameraPreviewPanel";

type CameraManagementViewProps = {
  cameras: Camera[];
  setCameras: Dispatch<SetStateAction<Camera[]>>;
  storageKey: string;
};

export function CameraManagementView({ cameras, setCameras, storageKey }: CameraManagementViewProps) {
  const [deleting, setDeleting] = useState(false);
  const {
    activeAction,
    activeCam,
    activeCamId,
    camerasLoading,
    cameraFormErrors,
    cameraPendingDelete,
    configuredCameraLimit,
    confirmDeleteCamera,
    counts,
    runtimeReady,
    area,
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
  const showingSettings = Boolean(isEditMode && activeCam && editForm);
  // My Cameras' rows fade in where their placeholders stood, when the placeholders were seen.
  const listReveal = useSkeletonReveal(camerasLoading && cameras.length === 0);

  return (
    <div className="camera-management flex h-full min-h-0 flex-col overflow-hidden font-sans">
      <AnimatePresence>
      {showAddModal && (
        <CameraAddModal key="add-camera"
          newCam={newCam}
          isValidating={isValidating}
          errors={cameraFormErrors}
          duplicateIpError={newCameraIpConflict ? CAMERA_IP_CONFLICT_MESSAGE : undefined}
          onClose={() => {
            setShowAddModal(false);
            setNewCam({ ...newCam, name: "", zone: "", cameraHost: "", rtsp: "", username: "", password: "" });
            setCameraFormErrors({});
          }}
          onSubmit={handleAddCamera}
          onChange={(values) => {
            setNewCam(values);
            // Only the edited field's error goes; a refused login stays until the credentials change.
            setCameraFormErrors((errors) => clearEditedFieldErrors(errors, newCam, values));
          }}
        />
      )}
      </AnimatePresence>
      {cameraPendingDelete && (
        <CameraDialog
          title="Remove Camera"
          description={`Remove ${cameraPendingDelete.name}?`}
          className="camera-confirm-dialog"
          busy={deleting}
          onClose={() => setCameraPendingDelete(null)}
          footer={
            <>
              <button type="button" className="design-button" disabled={deleting} onClick={() => setCameraPendingDelete(null)}>
                Keep Camera
              </button>
              <button
                type="button"
                className="design-button danger-button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await confirmDeleteCamera();
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Removing…" : "Remove Camera"}
              </button>
            </>
          }
        >
          <p>
            This stops visitor counting and removes the configuration for <b>{cameraPendingDelete.name}</b> only.
          </p>
          {monitoringError && (
            <p className="camera-field-error" role="alert">
              {monitoringError}
            </p>
          )}
        </CameraDialog>
      )}

      {!showingSettings && (
        <div className="camera-page-heading">
          <div className="min-w-0">
            <h2>Camera Monitoring</h2>
            <p>Monitor live video, visitor counts, and camera health.</p>
          </div>
        </div>
      )}

      <div
        data-camera-view={showingSettings ? "settings" : "monitoring"}
        className="camera-workspace"
      >
        {!showingSettings && (
          <CameraList
            cameras={cameras}
            activeCamId={activeCamId}
            cameraLimit={configuredCameraLimit}
            loading={camerasLoading}
            reveal={listReveal}
            onAdd={openAddModal}
            onDelete={setCameraPendingDelete}
            onSelect={(cameraId) => {
              setActiveCamId(cameraId);
              setIsEditMode(false);
            }}
          />
        )}
        <div className="camera-workspace-main">
          <CameraPreviewPanel
            loading={camerasLoading}
            runtimeReady={runtimeReady}
            storageKey={storageKey}
            cameras={cameras}
            area={area}
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
            onSave={handleSave}
            onStartProcessing={handleStartProcessing}
            onStopProcessing={handleStopProcessing}
            onTestConnection={() => void handleTestConnection()}
          />
        </div>
      </div>
    </div>
  );
}
