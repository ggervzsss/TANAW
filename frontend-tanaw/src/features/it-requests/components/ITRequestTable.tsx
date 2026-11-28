import type { ReactNode } from "react";
import { requestPlace } from "@/features/alerts-monitor/model";
import type { Request } from "@/shared/services/requests";
import { Button, cn, openRowFromClick } from "@/shared/ui-kit";
import { requestProgress, stateDotClass, stateTextClass, type Viewer } from "../model";
import "../itRequests.css";

type ITRequestTableProps = {
  requests: readonly Request[];
  selectedId: string | null;
  /**
   * The table shares the width with an open request: Place, Received and Reference step out of
   * the way, and the request's type and time read under its title.
   */
  compact: boolean;
  viewer: Viewer;
  /** "3:15 PM" today, "Yesterday, 3:15 PM", then the date and time. */
  formatReceived: (value: string) => string;
  onSelect: (request: Request) => void;
  onStart: (request: Request) => void;
  /** The request a Start on it is on its way for. */
  startingId: string | null;
  /** Shown instead of the rows when nothing is listed. */
  empty?: ReactNode;
};

/**
 * Requests waiting for IT, as a table: the request and its type, the place, when it arrived, its
 * progress and who has it, the reference number, and Start on it for one nobody has picked up. A
 * row opens as a whole (its title is the button); the open request's row keeps the green tint.
 * On phones each row stacks into a short record.
 */
export function ITRequestTable({ requests, selectedId, compact, viewer, formatReceived, onSelect, onStart, startingId, empty }: ITRequestTableProps) {
  if (requests.length === 0) return <div className="border-t border-(--tanaw-border-soft)">{empty}</div>;
  return (
    <table className="it-requests-table" data-compact={compact || undefined} aria-label="Requests">
      <thead>
        <tr>
          <th scope="col" className="it-requests-table__request">
            Request
          </th>
          <th scope="col" className="it-requests-table__place">
            Place
          </th>
          <th scope="col" className="it-requests-table__received">
            Received
          </th>
          <th scope="col" className="it-requests-table__status">
            Status
          </th>
          <th scope="col" className="it-requests-table__code">
            Reference
          </th>
          <th scope="col" className="it-requests-table__action">
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <RequestRow
            key={request.id}
            request={request}
            selected={request.id === selectedId}
            viewer={viewer}
            received={formatReceived(request.createdAt)}
            onSelect={onSelect}
            onStart={onStart}
            startingId={startingId}
          />
        ))}
      </tbody>
    </table>
  );
}

function RequestRow({
  request,
  selected,
  viewer,
  received,
  onSelect,
  onStart,
  startingId,
}: {
  request: Request;
  selected: boolean;
  viewer: Viewer;
  received: string;
  onSelect: (request: Request) => void;
  onStart: (request: Request) => void;
  startingId: string | null;
}) {
  const progress = requestProgress(request, viewer);
  const waiting = progress.state === "not-picked-up";
  return (
    <tr data-request-row={request.id} data-selected={selected || undefined} onClick={openRowFromClick} className="tanaw-row-link">
      <th scope="row" className="it-requests-table__request">
        <span className="it-requests-table__cell">
          <button
            type="button"
            data-row-primary
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(request)}
            className={cn("it-requests-table__title", waiting ? "font-bold" : "font-semibold")}
          >
            {request.title}
          </button>
          {/* Type always; the time and reference number join it when their own columns step out. */}
          <span className="it-requests-table__meta">
            <span>{request.group}</span>
            <span className="it-requests-table__meta-when">
              <span aria-hidden="true">·</span>
              <time dateTime={request.createdAt}>{received}</time>
            </span>
            <span className="it-requests-table__meta-code">
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{request.code}</span>
            </span>
          </span>
        </span>
      </th>
      <td className="it-requests-table__place">{requestPlace(request)}</td>
      <td className="it-requests-table__received">
        <time dateTime={request.createdAt}>{received}</time>
      </td>
      <td className="it-requests-table__status">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold">
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", stateDotClass[progress.state])} />
          <span className={stateTextClass[progress.state]}>{progress.label}</span>
          {progress.owner && <span className="font-medium text-(--tanaw-text-muted)">· {progress.owner}</span>}
        </span>
      </td>
      <td className="it-requests-table__code">{request.code}</td>
      <td className="it-requests-table__action">
        {waiting && (
          <Button size="md" className="whitespace-nowrap" onClick={() => onStart(request)} loading={startingId === request.id} disabled={startingId !== null}>
            Start on it<span className="sr-only"> ({request.code})</span>
          </Button>
        )}
      </td>
    </tr>
  );
}
