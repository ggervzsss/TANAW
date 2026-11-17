import { AnimatePresence } from "motion/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { CameraDialog } from "./CameraDialog";
import type { Camera } from "../../../types/enterprise";
import { CAMERA_IP_CONFLICT_MESSAGE } from "../utils/camera-ip-uniqueness";
import { useCameraManagement } from "../hooks/useCameraManagement";
import { CameraAddModal } from "./CameraAddModal";
import { CameraList, CameraSidebarToggle, CollapsedCameraListRail } from "./CameraList";
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

      <div className="camera-page-heading mb-4 flex shrink-0 items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight text-[#111827] dark:text-slate-50">Camera Monitoring</h2>
          <p className="truncate text-xs font-medium text-gray-500 dark:text-slate-400">View camera status and check if the counting is working properly.</p>
        </div>
        <PerformanceStatus effectiveProfile={health?.effective_processing_profile ?? null} analyticsFps={health?.analytics_fps ?? null} />
      </div>

      <div
        data-camera-sidebar={isCameraListCollapsed ? "collapsed" : "expanded"}
        className={`grid min-h-0 flex-1 transition-[grid-template-columns,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          isCameraListCollapsed ? "grid-cols-[30px_minmax(0,1fr)] gap-3" : "grid-cols-[minmax(190px,230px)_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-[176px_minmax(0,1fr)] max-[900px]:gap-3"
        }`}
      >
        <div id="configured-cameras-panel" className="relative min-h-0 min-w-0 overflow-visible">
          <div className="h-full min-h-0 overflow-hidden rounded-[18px]">
            <div
              {...(isCameraListCollapsed ? { inert: "" } : {})}
              aria-hidden={isCameraListCollapsed}
              className={`h-full w-57.5 origin-left transition-[opacity,filter] duration-150 motion-reduce:transition-none max-[900px]:w-44 ${isCameraListCollapsed ? "pointer-events-none opacity-0 blur-[2px]" : "blur-0 opacity-100 delay-100"}`}
            >
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
            <div
              {...(!isCameraListCollapsed ? { inert: "" } : {})}
              aria-hidden={!isCameraListCollapsed}
              className={`absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none ${isCameraListCollapsed ? "opacity-100 delay-150" : "pointer-events-none opacity-0"}`}
            >
              <CollapsedCameraListRail cameraCount={cameras.length} />
            </div>
          </div>
          <CameraSidebarToggle collapsed={isCameraListCollapsed} onToggle={() => setIsCameraListCollapsed((current) => !current)} />
        </div>
        <div className="min-h-0">
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
