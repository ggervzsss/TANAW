import { AnimatePresence } from "motion/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { CameraDialog } from "./CameraDialog";
import type { Camera } from "../../../types/enterprise";
import { CAMERA_IP_CONFLICT_MESSAGE } from "../utils/camera-ip-uniqueness";
import { useCameraManagement } from "../hooks/useCameraManagement";
import { CameraAddModal } from "./CameraAddModal";
import { CameraList } from "./CameraList";
import { CameraPreviewPanel } from "./CameraPreviewPanel";
import { PerformanceStatus } from "./PerformanceStatus";

type CameraManagementViewProps = {
  cameras: Camera[];
  setCameras: Dispatch<SetStateAction<Camera[]>>;
  storageKey: string;
};

export function CameraManagementView({ cameras, setCameras, storageKey }: CameraManagementViewProps) {
  const [deleting, setDeleting] = useState(false);
  const [isCameraListCollapsed, setIsCameraListCollapsed] = useState(false);
  const {
    activeAction,
    activeCam,
    activeCamId,
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

  return (
    <div className="camera-management animate-in fade-in flex h-full min-h-0 flex-col overflow-hidden font-sans duration-500">
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
            setCameraFormErrors({});
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
                {deleting ? "Removing?" : "Remove Camera"}
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
        <div className="camera-page-heading mb-4 flex shrink-0 items-end justify-between gap-4 px-1">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold tracking-tight text-(--tanaw-text)">Camera Monitoring</h2>
            <p className="text-xs font-medium text-(--tanaw-text-secondary)">Monitor live video, visitor counts, and camera health.</p>
          </div>
          <PerformanceStatus effectiveProfile={health?.effective_processing_profile ?? null} analyticsFps={health?.analytics_fps ?? null} />
        </div>
      )}

      <div
        data-camera-view={showingSettings ? "settings" : "monitoring"}
        data-camera-sidebar={isCameraListCollapsed ? "collapsed" : "expanded"}
        className="camera-workspace"
      >
        {!showingSettings && (
          <CameraList
            cameras={cameras}
            activeCamId={activeCamId}
            cameraLimit={configuredCameraLimit}
            collapsed={isCameraListCollapsed}
            onAdd={openAddModal}
            onToggle={() => setIsCameraListCollapsed((current) => !current)}
            onSelect={(cameraId) => {
              setActiveCamId(cameraId);
              setIsEditMode(false);
            }}
          />
        )}
        <div className="camera-workspace-main">
          <CameraPreviewPanel
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
