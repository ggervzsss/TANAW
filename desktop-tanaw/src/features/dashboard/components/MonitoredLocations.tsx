import { Video, VideoOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { routePaths } from "../../../app/router/routePaths";
import type { Camera } from "../../../types/enterprise";
import type { EstablishmentLive } from "../../camera/services/establishment.types";
import type { TicketDraftPrefill } from "../../tickets/model/ticket-draft";
import { useScrollableList } from "../hooks/useScrollableList";
import type { CameraStatusMarks } from "../utils/camera-status";
import { isCameraCounting } from "../utils/establishment";
import { LocationListLoading } from "./DashboardSkeleton";
import { useSkeletonReveal } from "../../../ui-kit/lib/skeleton";

type LocationsProps = {
  cameras: Camera[];
  live: EstablishmentLive | null;
  loading: boolean;
  marks: CameraStatusMarks;
  /** Formats a moment as "7:02 AM" when it is today, or as a date when it is earlier. */
  formatSince: (at: number) => string;
};

const MODE_TEXT: Record<string, string> = { entrance_exit: "Entry and exit", open_space: "Open space" };

export function MonitoredLocations({ cameras, live, loading, marks, formatSince }: LocationsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const list = useScrollableList<HTMLUListElement>(`${cameras.length}:${loading}:${cameras.filter((camera) => !isCameraCounting(camera.id, live)).length}`);
  const reveal = useSkeletonReveal(loading);

  const report = (camera: Camera, since: string | null) => {
    const ticketDraft: TicketDraftPrefill = {
      category: "Desktop app or camera problem",
      cameraNode: camera.name,
      subject: `${camera.name} is not counting`,
      description: `${camera.name} stopped counting visitors${since ? ` at ${since}` : ""}. The dashboard shows it as not counting.`,
    };
    navigate(routePaths.enterpriseTickets, { state: { returnTo: location.pathname, ticketDraft } });
  };

  return (
    <section className="dash-locations" aria-labelledby="dash-locations-title">
      <h2 id="dash-locations-title" className="dash-section-title">
        Monitored Locations
      </h2>
      <p className="dash-section-sub">Cameras at this enterprise.</p>
      {loading ? (
        <LocationListLoading label="Loading cameras" />
      ) : cameras.length === 0 ? (
        <p className="dash-locations-empty">Add a camera in Camera Setup to start counting visitors.</p>
      ) : (
        <ul ref={list.ref} className={reveal ? `dash-location-list ${reveal}` : "dash-location-list"} aria-label="Cameras" {...list.listProps}>
          {cameras.map((camera) => {
            const counting = isCameraCounting(camera.id, live);
            const down = live !== null && !counting;
            const mark = marks[String(camera.id)];
            const since = mark && mark.counting === counting ? formatSince(mark.since) : null;
            const mode = (camera.analysisMode && MODE_TEXT[camera.analysisMode]) || "Camera";
            return (
              <li key={camera.id} className={`dash-location${down ? " dash-location-down" : ""}`}>
                <span className="dash-location-icon" aria-hidden="true">
                  {down ? <VideoOff size={22} /> : <Video size={22} />}
                </span>
                <div className="dash-location-body">
                  <div className="dash-location-row">
                    <span className="dash-location-name">{camera.name}</span>
                    <span className={`dash-location-state${down ? " dash-location-state-down" : ""}`}>
                      <span className={`dash-dot ${live === null ? "dash-dot-off" : down ? "dash-dot-alert" : "dash-dot-live"}`} aria-hidden="true" />
                      {live === null ? "Checking" : down ? "Not counting" : "Monitoring"}
                    </span>
                  </div>
                  <p className="dash-location-meta">
                    {down
                      ? `Not counting${since ? ` since ${since}` : ""}. It shows as a live alert until the camera counts again.`
                      : `${mode}${since ? `, counting since ${since}` : ""}`}
                  </p>
                  {down && (
                    <button type="button" className="dash-button dash-button-alert" onClick={() => report(camera, since)}>
                      Report this to the IT
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
