import React, { useEffect, useState } from "react";
import { Edit2, Save, Trash2 } from "lucide-react";
import { Card } from "../../../components/Card";
import type { Camera } from "../../../types/enterprise";
import { CameraEditControls } from "./CameraEditControls";
import { CameraMonitoringPanel } from "./CameraMonitoringPanel";
import { CameraReadOnlyDetails } from "./CameraReadOnlyDetails";
import { CameraValidationWarnings } from "./CameraValidationWarnings";
import { CameraVideoPreview, type CameraPreviewState } from "./CameraVideoPreview";
import { NoCameraSelected } from "./NoCameraSelected";
import type { MlCounts, MlDetections, MlHealth, MlServiceStatus } from "../services/ml-service";

type CameraPreviewPanelProps = {
  activeCam?: Camera;
  cameraIpError?: string;
  counts: MlCounts;
  detections: MlDetections;
  editForm: Camera | null;
  error: string | null;
  hasStoredPassword: boolean;
  health: MlHealth | null;
  isRestartingService: boolean;
  isEditMode: boolean;
  isSaving: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isTesting: boolean;
  serviceStatus: MlServiceStatus | null;
  serviceError: string | null;
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
  cameraIpError,
  counts,
  detections,
  editForm,
  error,
  hasStoredPassword,
  health,
  isRestartingService,
  isEditMode,
  isSaving,
  isStarting,
  isStopping,
  isTesting,
  serviceStatus,
  serviceError,
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
  const [previewState, setPreviewState] =
    useState<CameraPreviewState>("connecting");

  useEffect(() => {
    setPreviewState("connecting");
  }, [activeCam?.id]);

  if (!activeCam) return <NoCameraSelected />;

  const isProcessing = counts.running;

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm shadow-md">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-[#111827]">{activeCam.name}</h3>
          <p className="truncate text-[11px] font-medium text-gray-500">
            {activeCam.zone} / {activeCam.status}
          </p>
        </div>
        <div className="flex gap-2">
          {isEditMode ? (
            <>
              <button
                onClick={onCancelEdit}
                disabled={isSaving}
                className="rounded-sm border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={isSaving || isStarting || Boolean(cameraIpError)}
                className="flex items-center gap-1.5 rounded-sm bg-[#065f46] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <Save size={14} /> {isSaving ? "Saving..." : isStarting ? "Restoring..." : "Save Config"}
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
              <button
                onClick={onDelete}
                className="rounded-sm border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:border-red-600 hover:text-red-600"
                aria-label="Delete camera"
              >
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
            onPreviewStateChange={setPreviewState}
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
            previewState={previewState}
            serviceStatus={serviceStatus}
            serviceError={serviceError}
            onRestartService={onRestartService}
            onStartProcessing={onStartProcessing}
            onStopProcessing={onStopProcessing}
            onTestConnection={onTestConnection}
          />
          <CameraValidationWarnings warnings={warnings} />
          {isEditMode && editForm ? (
            <CameraEditControls cameraIpError={cameraIpError} editForm={editForm} hasExistingPassword={hasStoredPassword} onEditFormChange={onEditFormChange} />
          ) : (
            <CameraReadOnlyDetails activeCam={activeCam} />
          )}
        </aside>
      </div>
    </Card>
  );
}
