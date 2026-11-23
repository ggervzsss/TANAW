import { ChevronDown, TrendingUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { busyCountsText, busyNames, busyPercentText, busySignature, busyTitle, type BusyEnterprise } from "../model/busyAlert";

const DISMISSED_KEY = "tanaw-dashboard-busy-dismissed";

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
    // The alert simply comes back on the next visit.
  }
}

type BusyAlertProps = {
  items: readonly BusyEnterprise[];
  monitoredCount: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  selectedEnterpriseId: string | null;
  onShow: (enterpriseId: string) => void;
};

function TrendIcon() {
  return (
    <span className="tanaw-busy__icon" aria-hidden="true">
      <TrendingUp size={15} strokeWidth={2.4} />
    </span>
  );
}

/**
 * "More visitors than usual": a floating card over the map naming the enterprises with more people
 * inside than usual for this hour. Dismissing it hides it until the list or its percentages change.
 */
export function BusyAlert({ items, monitoredCount, expanded, onExpandedChange, selectedEnterpriseId, onShow }: BusyAlertProps) {
  const titleId = useId();
  const signature = busySignature(items);
  const [dismissed, setDismissed] = useState(readDismissed);
  const viewAllRef = useRef<HTMLButtonElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(expanded);

  useEffect(() => {
    if (expanded && !wasExpanded.current) hideRef.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);

  const visible = items.length > 0 && dismissed !== signature;
  const title = busyTitle(items.length, monitoredCount);
  const [first] = items;

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
    <div className="tanaw-busy" role="status" aria-live="polite">
      {visible && first && expanded && items.length > 1 ? (
        <section className="tanaw-busy__panel" aria-labelledby={titleId} onKeyDown={onPanelKeyDown}>
          <div className="flex items-center gap-2.5 border-b border-(--dash-rule) py-2 pr-1.5 pl-2.5">
            <TrendIcon />
            <h3 id={titleId} className="m-0 min-w-0 flex-1 text-sm font-bold text-(--tanaw-warn-ink)">
              {title}
            </h3>
            <button ref={hideRef} type="button" aria-expanded="true" onClick={collapse} className="tanaw-busy-button inline-flex items-center gap-1">
              Hide <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          <ol className="m-0 max-h-62 list-none overflow-y-auto p-1.5">
            {items.map((item) => {
              const content = (
                <>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold">{item.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-(--tanaw-text-muted)">
                      Barangay {item.barangay}
                      {item.pinned ? "" : ", not pinned on the map"}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-bold text-(--tanaw-warn-ink) tabular-nums">{item.percent === null ? "Above usual" : `+${item.percent}%`}</span>
                    <span className="mt-0.5 block text-xs whitespace-nowrap text-(--tanaw-text-muted) tabular-nums">{busyCountsText(item, true)}</span>
                  </span>
                </>
              );
              return (
                <li key={item.enterpriseId}>
                  {item.pinned ? (
                    <button
                      type="button"
                      className="tanaw-busy-row"
                      aria-pressed={item.enterpriseId === selectedEnterpriseId}
                      aria-label={`Show ${item.name} on the map, ${busyPercentText(item)}`}
                      onClick={() => onShow(item.enterpriseId)}
                    >
                      {content}
                    </button>
                  ) : (
                    <Link className="tanaw-busy-row" to={adminEnterpriseDetailsPath(item.enterpriseId)} aria-label={`View details: ${item.name}, ${busyPercentText(item)}`}>
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : visible && first ? (
        <div className="tanaw-busy__card">
          <TrendIcon />
          <span className="min-w-0">
            <span className="block font-bold text-(--tanaw-warn-ink)">{title}</span>
            <span className="mt-0.5 block truncate text-(--tanaw-text-secondary)">
              {items.length === 1 ? (
                <>
                  <strong className="font-semibold text-(--tanaw-text)">{first.name}</strong>, {busyPercentText(first)}. {busyCountsText(first)}
                </>
              ) : (
                busyNames(items)
              )}
            </span>
          </span>
          {items.length === 1 ? (
            first.pinned ? (
              <button type="button" className="tanaw-busy-button" onClick={() => onShow(first.enterpriseId)}>
                Show
              </button>
            ) : (
              <Link to={adminEnterpriseDetailsPath(first.enterpriseId)} className="tanaw-busy-button inline-flex items-center no-underline">
                View details
              </Link>
            )
          ) : (
            <button ref={viewAllRef} type="button" aria-expanded="false" className="tanaw-busy-button" onClick={() => onExpandedChange(true)}>
              View all
            </button>
          )}
          <button
            type="button"
            className="tanaw-busy-button tanaw-busy-button--icon"
            onClick={dismiss}
            aria-label={items.length === 1 ? "Dismiss this alert" : "Dismiss these alerts until something changes"}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
