import React from "react";
import { Edit2, Save, Trash2 } from "lucide-react";
import { Card } from "../../../components/Card";
import type { Camera } from "../../../types/enterprise";
import { CameraEditControls } from "./CameraEditControls";
import { CameraMonitoringPanel } from "./CameraMonitoringPanel";
import { CameraReadOnlyDetails } from "./CameraReadOnlyDetails";
import { CameraValidationWarnings } from "./CameraValidationWarnings";
import { CameraVideoPreview } from "./CameraVideoPreview";
import { NoCameraSelected } from "./NoCameraSelected";
import type { MlCounts, MlDetections, MlHealth, MlServiceStatus } from "../services/ml-service";

type CameraPreviewPanelProps = {
  activeCam?: Camera;
  counts: MlCounts;
  detections: MlDetections;
  editForm: Camera | null;
  error: string | null;
  health: MlHealth | null;
  isRestartingService: boolean;
  isEditMode: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isTesting: boolean;
  processingCameraId: number | null;
  serviceStatus: MlServiceStatus | null;
  streamUrl: string;
  warnings: string[];
  onCancelEdit: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRestartService: () => void;
  onSave: () => void;
  onStartProcessing: () => void;
  onStopProcessing: () => void;
  onTestConnection: () => void;
  onEditFormChange: React.Dispatch<React.SetStateAction<Camera | null>>;
};

export function CameraPreviewPanel({
  activeCam,
  counts,
  detections,
  editForm,
  error,
  health,
  isRestartingService,
  isEditMode,
  isStarting,
  isStopping,
  isTesting,
  processingCameraId,
  serviceStatus,
  streamUrl,
  warnings,
  onCancelEdit,
  onDelete,
  onEdit,
  onRestartService,
  onSave,
  onStartProcessing,
  onStopProcessing,
  onTestConnection,
  onEditFormChange,
}: CameraPreviewPanelProps) {
  if (!activeCam) return <NoCameraSelected />;

  const isProcessing = processingCameraId === activeCam.id && counts.running;

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm shadow-md">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-[#111827]">{activeCam.name}</h3>
          <p className="truncate text-[11px] font-medium text-gray-500">
            {activeCam.zone} / {formatCameraType(activeCam.cameraType)} / {activeCam.status}
          </p>
        </div>
        <div className="flex gap-2">
          {isEditMode ? (
            <>
              <button onClick={onCancelEdit} className="rounded-sm border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-100">
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={isStarting}
                className="flex items-center gap-1.5 rounded-sm bg-[#065f46] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <Save size={14} /> {isStarting ? "Applying..." : "Save Config"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="rounded-sm border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:border-[#065f46] hover:text-[#065f46]"
                aria-label="Edit configuration"
              >
                <Edit2 size={14} />
              </button>
              <button onClick={onDelete} className="rounded-sm border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:border-red-600 hover:text-red-600" aria-label="Delete camera">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,340px)] gap-4 bg-gray-50 p-4 max-xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-0">
          <CameraVideoPreview
            activeCam={activeCam}
            counts={counts}
            detections={detections}
            editForm={editForm}
            health={health}
            isProcessing={isProcessing}
            isEditMode={isEditMode}
            onEditFormChange={onEditFormChange}
            streamUrl={streamUrl}
          />
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <CameraMonitoringPanel
            activeCam={activeCam}
            counts={counts}
            error={error}
            health={health}
            isRestartingService={isRestartingService}
            isStarting={isStarting}
            isStopping={isStopping}
            isTesting={isTesting}
            processingCameraId={processingCameraId}
            serviceStatus={serviceStatus}
            onRestartService={onRestartService}
            onStartProcessing={onStartProcessing}
            onStopProcessing={onStopProcessing}
            onTestConnection={onTestConnection}
          />
          <CameraValidationWarnings warnings={warnings} />
          {isEditMode && editForm ? <CameraEditControls editForm={editForm} onEditFormChange={onEditFormChange} /> : <CameraReadOnlyDetails activeCam={activeCam} />}
        </aside>
      </div>
    </Card>
  );
}

function formatCameraType(cameraType: Camera["cameraType"]) {
  const labels: Record<Camera["cameraType"], string> = {
    IP_WEBCAM: "IP Webcam",
    ONVIF_CCTV: "ONVIF CCTV",
    RTSP_CCTV: "RTSP CCTV",
    USB_WEBCAM: "USB Webcam",
  };

  return labels[cameraType];
}
