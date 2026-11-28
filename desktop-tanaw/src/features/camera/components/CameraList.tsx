import { Plus, Trash2, Video } from "lucide-react";
import { Badge, Button, cn } from "../../../ui-kit";
import type { Camera } from "../../../types/enterprise";
import { cameraModeName } from "../utils/camera-mode";
import { CameraListPlaceholders } from "./CameraSetupSkeleton";

type CameraListProps = {
  cameras: Camera[];
  activeCamId: number | null;
  cameraLimit: number;
  /** The saved cameras are still loading; rows show placeholders in their shape. */
  loading?: boolean;
  /** The skeleton-reveal class (useSkeletonReveal), while the rows take their placeholders' place. */
  reveal?: string;
  onSelect: (cameraId: number) => void;
  onAdd: () => void;
  onDelete: (camera: Camera) => void;
};

export function CameraList({ cameras, activeCamId, cameraLimit, loading = false, reveal, onAdd, onDelete, onSelect }: CameraListProps) {
  const cameraLimitReached = cameras.length >= cameraLimit;
  const limitMessage = `This Enterprise account can register up to ${cameraLimit} cameras.`;
  const showPlaceholders = loading && cameras.length === 0;

  return (
    <section className="camera-list" aria-labelledby="camera-list-title" aria-busy={showPlaceholders || undefined}>
      <header className="camera-list-heading">
        <h3 id="camera-list-title">My Cameras</h3>
      </header>
      <nav className="camera-list-items" aria-label="Configured cameras">
        {cameras.map((camera) => {
          const mode = cameraModeName(camera.analysisMode);
          const label = [camera.name, camera.zone, mode, camera.status].filter(Boolean).join(", ");
          const selected = activeCamId === camera.id;
          const deleteLabel = `Delete ${camera.name}`;
          return (
            <div key={camera.id} className={cn("camera-list-row", reveal)} data-selected={selected || undefined}>
              <button type="button" className="camera-list-item" onClick={() => onSelect(camera.id)}
                aria-label={label} title={label} aria-pressed={selected}>
                <span className="camera-list-glyph" aria-hidden="true">
                  <Video size={18} />
                </span>
                <span className="camera-list-item-copy" aria-hidden="true">
                  <strong>{camera.name}</strong>
                  <span className="camera-list-zone">{camera.zone || mode}</span>
                  <span className="camera-list-item-footer">
                    {camera.zone && <span>{mode}</span>}
                    <CameraStatusBadge status={camera.status} />
                  </span>
                </span>
              </button>
              <button type="button" className="camera-list-delete" aria-label={deleteLabel} title={deleteLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(camera);
                }}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
        {showPlaceholders && <CameraListPlaceholders />}
        {cameras.length === 0 && !showPlaceholders && <p className={cn("camera-list-empty", reveal)}>No cameras registered.</p>}
      </nav>
      <footer className="camera-list-footer">
        <Button className="camera-add-button" variant="secondary" fullWidth leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={onAdd} disabled={cameraLimitReached}
          aria-describedby={cameraLimitReached ? "camera-configuration-limit" : undefined}>
          Add Camera
        </Button>
        {cameraLimitReached && <p id="camera-configuration-limit">{limitMessage}</p>}
      </footer>
    </section>
  );
}

export function CameraStatusBadge({ status }: { status: string }) {
  return <Badge size="sm" tone={cameraStatusTone(status)} dot>{status}</Badge>;
}

function cameraStatusTone(status: string) {
  return status === "running" || status === "online"
    ? "success"
    : ["starting", "stopping", "connecting", "degraded", "reconnecting"].includes(status)
      ? "warning"
      : ["offline", "failed", "error"].includes(status) ? "danger" : "neutral";
}
