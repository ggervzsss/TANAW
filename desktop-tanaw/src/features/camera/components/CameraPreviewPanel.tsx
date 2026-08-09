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
  const [previewState, setPreviewState] = useState<CameraPreviewState>("connecting");

  useEffect(() => {
    setPreviewState("connecting");
  }, [activeCam?.id]);

  if (!activeCam) return <NoCameraSelected />;

  const isProcessing = counts.running;

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-200/90 bg-white shadow-[0_22px_56px_rgba(15,23,42,0.1)] dark:border-white/8 dark:bg-[#111c2a] dark:shadow-[0_24px_62px_rgba(2,8,18,0.34)]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-4 py-3.5 dark:border-white/8 dark:bg-[#142130]/96">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-[#111827] dark:text-slate-50">{activeCam.name}</h3>
          <p className="truncate text-[11px] font-medium text-gray-500 dark:text-slate-400">
            {activeCam.zone} / {activeCam.status}
          </p>
        </div>
        <div className="flex gap-2">
          {isEditMode ? (
            <>
              <button
                onClick={onCancelEdit}
                disabled={isSaving}
                className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/6"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={isSaving || isStarting || Boolean(cameraIpError)}
                className="flex items-center gap-1.5 rounded-xl bg-[#065f46] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <Save size={14} /> {isSaving ? "Saving..." : isStarting ? "Restoring..." : "Save Config"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 transition-colors hover:border-[#065f46] hover:text-[#065f46] dark:border-white/10 dark:bg-white/3 dark:text-slate-400 dark:hover:border-emerald-400/35 dark:hover:text-emerald-300"
                aria-label="Edit configuration"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={onDelete}
                className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 transition-colors hover:border-red-600 hover:text-red-600 dark:border-white/10 dark:bg-white/3 dark:text-slate-400 dark:hover:border-red-400/40 dark:hover:text-red-300"
                aria-label="Delete camera"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,340px)] gap-4 bg-slate-50/80 p-4 max-[1180px]:block max-[1180px]:overflow-y-auto max-[1180px]:p-3 dark:bg-[#0d1724]">
        <div className="min-h-0 max-[1180px]:h-80 max-[900px]:h-72">
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

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 max-[1180px]:mt-3 max-[1180px]:overflow-visible max-[1180px]:pr-0">
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
