import { CameraOff, ChevronDown, TrendingUp, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { alertKindLabel, alertPlace, alertSince, alertTone } from "@/features/live-alerts";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { LiveAlert } from "@/shared/types";
import { mapAlertsPlaces, mapAlertsSignature, mapAlertsTitle, mapAlertsTone, type MapAlertTone } from "../model/mapAlerts";

const DISMISSED_KEY = "tanaw-dashboard-alerts-dismissed";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function saveDismissed(signature: string) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, signature);
  } catch {
    // The card simply comes back on the next visit.
  }
}

function ToneIcon({ tone }: { tone: MapAlertTone }) {
  const Icon = tone === "camera" ? CameraOff : tone === "busy" ? TrendingUp : TriangleAlert;
  return (
    <span className={`tanaw-map-alerts__icon tanaw-map-alerts__icon--${tone}`} aria-hidden="true">
      <Icon size={15} strokeWidth={2.4} />
    </span>
  );
}

type MapAlertsProps = {
  alerts: readonly LiveAlert[];
  /** Places with a pin on the map; the others open their details instead. */
  pinnedIds: ReadonlySet<string>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  selectedEnterpriseId: string | null;
  onShow: (enterpriseId: string) => void;
};

/**
 * The live alerts, floating over the bottom of the map: one line for a single alert, or a
 * summary that opens the full list. Dismissing hides it until an alert starts or ends.
 */
export function MapAlerts({ alerts, pinnedIds, expanded, onExpandedChange, selectedEnterpriseId, onShow }: MapAlertsProps) {
  const titleId = useId();
  const { timeFormat } = useSystemDisplayPreferences();
  const signature = mapAlertsSignature(alerts);
  const [dismissed, setDismissed] = useState(readDismissed);
  const viewAllRef = useRef<HTMLButtonElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(expanded);

  useEffect(() => {
    if (expanded && !wasExpanded.current) hideRef.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);

  const visible = alerts.length > 0 && dismissed !== signature;
  const tone = mapAlertsTone(alerts);
  const title = mapAlertsTitle(alerts);
  const [first] = alerts;
  const now = new Date();
  const isPinned = (alert: LiveAlert) => Boolean(alert.enterpriseId && pinnedIds.has(alert.enterpriseId));

  const dismiss = () => {
    saveDismissed(signature);
    setDismissed(signature);
    onExpandedChange(false);
  };
  const collapse = () => {
    onExpandedChange(false);
    requestAnimationFrame(() => viewAllRef.current?.focus());
  };
  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    collapse();
  };

  return (
    <div className="tanaw-map-alerts" role="status" aria-live="polite">
      {visible && first && expanded && alerts.length > 1 ? (
        <section className="tanaw-map-alerts__panel" aria-labelledby={titleId} onKeyDown={onPanelKeyDown}>
          <div className="flex items-center gap-3 border-b border-(--dash-rule) py-2 pr-2 pl-3">
            <ToneIcon tone={tone} />
            <h3 id={titleId} className={`tanaw-map-alerts__title tanaw-map-alerts__title--${tone} m-0 min-w-0 flex-1 text-sm font-bold`}>
              {title}
            </h3>
            <button ref={hideRef} type="button" aria-expanded="true" onClick={collapse} className="tanaw-map-alerts-button inline-flex items-center gap-1">
              Hide <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          <ol className="m-0 max-h-62 list-none overflow-y-auto p-2" aria-label="Live alerts">
            {alerts.map((alert) => {
              const rowTone = alertTone(alert);
              const content = (
                <>
                  <ToneIcon tone={rowTone} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{alertPlace(alert)}</span>
                    <span className="mt-0.5 block truncate text-xs text-(--tanaw-text-muted)">
                      {alertSince(alert.startedAt, now, timeFormat)}
                      {isPinned(alert) ? "" : " · not pinned on the map"}
                    </span>
                  </span>
                  <span className={`tanaw-map-alerts__title--${rowTone} text-right text-xs font-bold whitespace-nowrap`}>{alertKindLabel(alert)}</span>
                </>
              );
              return (
                <li key={alert.id} data-alert-tone={rowTone}>
                  {isPinned(alert) && alert.enterpriseId ? (
                    <button
                      type="button"
                      className="tanaw-map-alerts-row"
                      aria-pressed={alert.enterpriseId === selectedEnterpriseId}
                      aria-label={`Show ${alertPlace(alert)} on the map, ${alertKindLabel(alert).toLowerCase()}`}
                      onClick={() => onShow(alert.enterpriseId!)}
                    >
                      {content}
                    </button>
                  ) : alert.enterpriseId ? (
                    <Link className="tanaw-map-alerts-row" to={adminEnterpriseDetailsPath(alert.enterpriseId)} aria-label={`View details: ${alertPlace(alert)}, ${alertKindLabel(alert).toLowerCase()}`}>
                      {content}
                    </Link>
                  ) : (
                    <div className="tanaw-map-alerts-row">{content}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : visible && first ? (
        <div className="tanaw-map-alerts__card">
          <ToneIcon tone={tone} />
          <span className="min-w-0">
            <span className={`tanaw-map-alerts__title tanaw-map-alerts__title--${tone} block font-bold`}>{title}</span>
            <span className="mt-0.5 block truncate text-(--tanaw-text-secondary)">
              {alerts.length === 1 ? (
                <>
                  <strong className="font-semibold text-(--tanaw-text)">{alertPlace(first)}</strong>, {alertSince(first.startedAt, now, timeFormat).toLowerCase()}
                </>
              ) : (
                mapAlertsPlaces(alerts)
              )}
            </span>
          </span>
          {alerts.length === 1 ? (
            isPinned(first) && first.enterpriseId ? (
              <button type="button" className="tanaw-map-alerts-button" onClick={() => onShow(first.enterpriseId!)}>
                Show
              </button>
            ) : first.enterpriseId ? (
              <Link to={adminEnterpriseDetailsPath(first.enterpriseId)} className="tanaw-map-alerts-button inline-flex items-center no-underline">
                View details
              </Link>
            ) : (
              <span />
            )
          ) : (
            <button ref={viewAllRef} type="button" aria-expanded="false" className="tanaw-map-alerts-button" onClick={() => onExpandedChange(true)}>
              View all
            </button>
          )}
          <button
            type="button"
            className="tanaw-map-alerts-button tanaw-map-alerts-button--icon"
            onClick={dismiss}
            aria-label={alerts.length === 1 ? "Dismiss this alert" : "Dismiss these alerts until something changes"}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
