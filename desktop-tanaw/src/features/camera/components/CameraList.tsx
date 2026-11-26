import { PanelLeftClose, PanelLeftOpen, Plus, Video } from "lucide-react";
import { Badge, Button, Skeleton, Tooltip, initialsOf } from "../../../ui-kit";
import type { Camera } from "../../../types/enterprise";
import { cameraModeName } from "../utils/camera-mode";

type CameraListProps = {
  cameras: Camera[];
  activeCamId: number | null;
  cameraLimit: number;
  collapsed: boolean;
  /** The saved cameras are still loading; rows show placeholders in their shape. */
  loading?: boolean;
  onSelect: (cameraId: number) => void;
  onAdd: () => void;
  onToggle: () => void;
};

export function CameraList({ cameras, activeCamId, cameraLimit, collapsed, loading = false, onAdd, onSelect, onToggle }: CameraListProps) {
  const cameraLimitReached = cameras.length >= cameraLimit;
  const countLabel = `${cameras.length} configured ${cameras.length === 1 ? "camera" : "cameras"}`;
  const limitMessage = `This Enterprise account can register up to ${cameraLimit} cameras.`;
  const toggleLabel = collapsed ? "Expand configured cameras" : "Collapse configured cameras";
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const showPlaceholders = loading && cameras.length === 0;

  return (
    <section className="camera-list" aria-labelledby="camera-list-title" aria-busy={showPlaceholders || undefined} data-compact={collapsed}>
      <header className="camera-list-heading">
        <h3 id="camera-list-title">My Cameras</h3>
        <span className="camera-list-count" aria-label={countLabel} role="img" title={countLabel}>{cameras.length}</span>
        <Tooltip align="left" content={toggleLabel} focusable={false}>
          <button type="button" className="camera-sidebar-toggle" onClick={onToggle}
            aria-controls="configured-cameras-panel" aria-expanded={!collapsed} aria-label={toggleLabel}>
            <ToggleIcon size={18} aria-hidden="true" />
          </button>
        </Tooltip>
      </header>
      <nav className="camera-list-items" id="configured-cameras-panel" aria-label="Configured cameras">
        {cameras.map((camera) => {
          const mode = cameraModeName(camera.analysisMode);
          const label = [camera.name, camera.zone, mode, camera.status].filter(Boolean).join(", ");
          return (
            <button key={camera.id} type="button" className="camera-list-item" onClick={() => onSelect(camera.id)}
              aria-label={label} title={label} aria-pressed={activeCamId === camera.id}>
              <span className="camera-list-glyph" aria-hidden="true" data-tone={cameraStatusTone(camera.status)}>
                <Video size={18} />
                <span>{initialsOf(camera.name)}</span>
              </span>
              <span className="camera-list-item-copy" aria-hidden="true">
                <strong>{camera.name}</strong>
                <span className="camera-list-zone">{camera.zone || mode}</span>
                <span className="camera-list-item-footer">
                  {camera.zone && <span>{mode}</span>}
                  <CameraStatusBadge status={camera.status} />
                </span>
              </span>
              <span className="camera-list-short-name" aria-hidden="true">{camera.name}</span>
            </button>
          );
        })}
        {showPlaceholders && (
          <span className="camera-list-placeholders" role="status" aria-label="Loading cameras">
            {[0, 1, 2].map((row) => (
              <span key={row} className="camera-list-placeholder" aria-hidden="true">
                <Skeleton className="camera-list-placeholder-glyph" />
                <span className="camera-list-placeholder-copy">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </span>
              </span>
            ))}
          </span>
        )}
        {cameras.length === 0 && !collapsed && !showPlaceholders && <p className="camera-list-empty">No cameras registered.</p>}
      </nav>
      <footer className="camera-list-footer">
        <Button className="camera-add-button" variant="secondary" fullWidth leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={onAdd} disabled={cameraLimitReached} aria-label={collapsed ? "Add Camera" : undefined}
          title={collapsed ? (cameraLimitReached ? limitMessage : "Add Camera") : undefined}
          aria-describedby={cameraLimitReached ? "camera-configuration-limit" : undefined}>
          Add Camera
        </Button>
        {cameraLimitReached && <p id="camera-configuration-limit" className={collapsed ? "sr-only" : undefined}>{limitMessage}</p>}
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
