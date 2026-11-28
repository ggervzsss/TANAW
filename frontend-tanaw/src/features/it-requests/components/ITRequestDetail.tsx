import { ArrowRight, Check } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { requestPlace } from "@/features/alerts-monitor/model";
import { RequestPhotos } from "@/features/alerts-monitor/components";
import type { Request, RequestDetail } from "@/shared/services/requests";
import { Button, Skeleton, cn } from "@/shared/ui-kit";
import { useEnterpriseAppHealth, useRequestActions, type RequestAction } from "../hooks";
import {
  appToneClass,
  approveBlockedReason,
  areaAndCamera,
  buildTimeline,
  desktopAppStatus,
  handledByLabel,
  itEnterpriseLink,
  moveOptions,
  requestActions,
  requestState,
  stateDotClass,
  stateLabels,
  stateTextClass,
  statusNote,
  type TimelineKind,
  type Viewer,
} from "../model";
import { MoveRequestMenu } from "./MoveRequestMenu";
import { ReplyComposer } from "./ReplyComposer";

type ITRequestDetailProps = {
  request: Request;
  detail: RequestDetail | null;
  detailLoading: boolean;
  viewer: Viewer;
  now: Date;
  /** Formats a timestamp: "3:15 PM" today, the date and time on other days. */
  formatWhen: (value: string) => string;
  /** Called after an action succeeds, so the page can keep this request selected. */
  onActed?: (request: Request) => void;
};

const dotBorder: Record<TimelineKind, string> = {
  sent: "border-(--tanaw-action)",
  message: "border-(--tanaw-action)",
  progress: "border-(--tanaw-accent-ink)",
  approved: "border-(--tanaw-accent-ink)",
  resolved: "border-(--tanaw-text-secondary)",
  reopened: "border-(--tanaw-warn-ink)",
  note: "border-(--tanaw-warn-ink)",
  reply: "border-(--tanaw-focus-ring)",
};

const dotFill: Record<TimelineKind, string> = {
  sent: "bg-(--tanaw-action)",
  message: "bg-(--tanaw-action)",
  progress: "bg-(--tanaw-accent-ink)",
  approved: "bg-(--tanaw-accent-ink)",
  resolved: "bg-(--tanaw-text-secondary)",
  reopened: "bg-(--tanaw-warn-ink)",
  note: "bg-(--tanaw-warn-ink)",
  reply: "bg-(--tanaw-focus-ring)",
};

/**
 * The right pane: status, IT's actions, what happened, the change asked for, the details, the
 * conversation and the reply box. Mount it with `key={request.id}` so another request starts
 * with an empty reply.
 */
export function ITRequestDetail({ request, detail, detailLoading, viewer, now, formatWhen, onActed }: ITRequestDetailProps) {
  const [draft, setDraft] = useState("");
  const reasonId = useId();
  const afterAction = (action: RequestAction) => {
    onActed?.(request);
    if (action.kind === "reply" || action.kind === "decline") setDraft("");
  };
  const { run, pending } = useRequestActions(request, { onDone: afterAction });
  const health = useEnterpriseAppHealth(request.enterpriseId);
  const state = requestState(request);
  const actions = requestActions(request);
  const blocked = actions.canDecide ? approveBlockedReason(request.accountChange) : null;
  const timeline = buildTimeline(request, detail);
  const change = request.accountChange;
  const busy = pending !== null;
  const sentBy = request.requesterEmail ? `${request.requesterName} (${request.requesterEmail})` : request.requesterName;
  const hasActions = actions.canStart || actions.canDecide || actions.canResolve || actions.canReopen || actions.canMove;

  return (
    <article aria-labelledby="it-request-title" className="it-requests__detail min-w-0 py-1.5">
      <p className="flex items-center gap-2.5 text-[0.8125rem] font-semibold">
        <span className={stateTextClass[state]}>{stateLabels[state]}</span>
        <span className="font-semibold text-(--tanaw-text-muted) tabular-nums">{request.code}</span>
      </p>
      <h2 id="it-request-title" className="mt-2 text-[1.375rem] leading-tight font-[650] tracking-[-0.015em] text-(--tanaw-text) max-sm:text-xl">
        {request.title}
      </h2>
      <p role="status" className="mt-2.5 flex items-center gap-2 text-[0.90625rem] text-(--tanaw-text-secondary)">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", stateDotClass[state])} />
        {statusNote(request, viewer, formatWhen)}
      </p>

      {hasActions && (
        // On phones the actions share the width: two to a row, and the type menu on a row of its own.
        <div role="group" aria-label={`Actions for ${request.code}`} className="mt-4.5 flex flex-wrap items-center gap-2.5 max-sm:*:flex-1">
          {actions.canStart && (
            <Button size="lg" className="h-11 text-sm" loading={pending === "start"} disabled={busy && pending !== "start"} onClick={() => run({ kind: "start" })}>
              Start on it
            </Button>
          )}
          {actions.canDecide && (
            <>
              <Button
                size="lg"
                className="h-11 text-sm"
                leadingIcon={<Check size={16} aria-hidden="true" />}
                disabled={Boolean(blocked) || (busy && pending !== "approve")}
                loading={pending === "approve"}
                aria-describedby={blocked ? reasonId : undefined}
                onClick={() => run({ kind: "approve" })}
              >
                Approve change
              </Button>
              <Button
                variant="danger"
                size="lg"
                className="h-11 text-sm"
                loading={pending === "decline"}
                disabled={busy && pending !== "decline"}
                onClick={() => run({ kind: "decline", reason: draft.trim() })}
              >
                Decline
              </Button>
            </>
          )}
          {actions.canResolve && (
            <Button
              size="lg"
              variant={actions.canStart ? "secondary" : "primary"}
              className="h-11 text-sm"
              leadingIcon={<Check size={16} aria-hidden="true" />}
              loading={pending === "resolve"}
              disabled={busy && pending !== "resolve"}
              onClick={() => run({ kind: "resolve" })}
            >
              Mark resolved
            </Button>
          )}
          {actions.canReopen && (
            <Button variant="secondary" size="lg" className="h-11 text-sm" loading={pending === "reopen"} disabled={busy && pending !== "reopen"} onClick={() => run({ kind: "reopen" })}>
              Reopen
            </Button>
          )}
          {actions.canMove && <MoveRequestMenu options={moveOptions(request)} loading={pending === "move"} disabled={busy && pending !== "move"} onMove={(group) => run({ kind: "move", group })} />}
        </div>
      )}
      {blocked && (
        <p id={reasonId} className="mt-2 max-w-[68ch] text-[0.84375rem] font-semibold text-(--tanaw-warn-ink)">
          {blocked}
        </p>
      )}

      <h3 className="mt-7 text-base font-[650]">What happened</h3>
      <p className="mt-1.5 max-w-[68ch] leading-relaxed whitespace-pre-line text-(--tanaw-text-secondary)">{request.description}</p>

      {change && (
        <div className="mt-5 max-w-184">
          <p className="mb-1 text-[13px] font-medium text-(--tanaw-text-secondary)">{change.label}</p>
          {/* Open, not boxed: the current and the asked-for value read across one ruled line. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-5 gap-y-3 border-y border-(--tanaw-border-soft) py-3.5">
            <div className="min-w-0">
              <span className="block text-[13px] text-(--tanaw-text-muted)">Now</span>
              <span className="mt-0.5 block font-semibold wrap-anywhere">{change.currentValue || "Not set"}</span>
            </div>
            <ArrowRight size={18} aria-hidden="true" className="text-(--tanaw-text-muted)" />
            <span className="sr-only">changes to</span>
            <div className="min-w-0">
              <span className="block text-[13px] text-(--tanaw-text-muted)">Asked for</span>
              <span className="mt-0.5 block font-semibold wrap-anywhere text-(--tanaw-accent-ink)">{change.requestedValue}</span>
            </div>
          </div>
        </div>
      )}

      <h3 className="mt-6 text-base font-[650]">Details</h3>
      <dl className="mt-2 grid grid-cols-2 border-t border-(--tanaw-border-soft) max-sm:grid-cols-1">
        <DetailItem label="Place">
          {request.enterpriseId ? (
            <Link
              to={itEnterpriseLink(request.enterpriseId)}
              className="rounded-sm text-(--tanaw-accent-ink) no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
            >
              {request.enterpriseName ?? requestPlace(request)}
            </Link>
          ) : (
            <span className="font-semibold text-(--tanaw-text-secondary)">Not linked to an enterprise</span>
          )}
        </DetailItem>
        <DetailItem label="Type">{request.group}</DetailItem>
        <DetailItem label="Sent by">{sentBy}</DetailItem>
        <DetailItem label="Handled by">{handledByLabel(request, viewer)}</DetailItem>
        <DetailItem label="Desktop app">
          <AppStatus enterpriseId={request.enterpriseId ?? null} query={health} now={now} formatWhen={formatWhen} />
        </DetailItem>
        <DetailItem label="Area and camera">{areaAndCamera(request)}</DetailItem>
      </dl>

      <RequestPhotos attachments={request.attachments ?? []} />

      <h3 className="mt-6 text-base font-[650]">Conversation and updates</h3>
      <ol aria-busy={detailLoading || undefined} className="mt-2.5 list-none pl-2">
        {timeline.map((entry, index) => (
          <li key={entry.id} className="relative border-l-2 border-(--tanaw-border-soft) pb-3.5 pl-5.5 last:border-transparent last:pb-1">
            <span aria-hidden="true" className={cn("absolute top-0.5 -left-1.75 size-3 rounded-full border-2", dotBorder[entry.kind], index === 0 ? dotFill[entry.kind] : "bg-(--tanaw-page)")} />
            <div className={cn(entry.kind === "note" && "rounded-tanaw-md bg-(--tanaw-warning-surface) px-3 py-2")}>
              <p className="font-semibold text-(--tanaw-text)">
                {entry.title} {entry.at && <span className="text-[0.8125rem] font-medium text-(--tanaw-text-muted)">{formatWhen(entry.at)}</span>}
              </p>
              <p className="mt-0.75 text-sm wrap-break-word whitespace-pre-line text-(--tanaw-text-secondary)">{entry.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {detailLoading && (
        <div role="status" aria-label="Loading the conversation." className="mt-1 pb-1 pl-7.5">
          <span className="flex h-6 items-center">
            <Skeleton className="h-4 w-48" />
          </span>
          <span className="mt-0.75 flex h-5 items-center">
            <Skeleton className="h-3 w-3/4 max-w-120" />
          </span>
        </div>
      )}

      <ReplyComposer request={request} draft={draft} onDraftChange={setDraft} pending={pending} onSend={(resolve) => run({ kind: "reply", message: draft.trim(), resolve })} />
    </article>
  );
}

function AppStatus({ enterpriseId, query, now, formatWhen }: { enterpriseId: string | null; query: ReturnType<typeof useEnterpriseAppHealth>; now: Date; formatWhen: (value: string) => string }) {
  if (!enterpriseId) return <span className="font-semibold text-(--tanaw-text-secondary)">No place linked</span>;
  if (query.isLoading) return <span className="font-semibold text-(--tanaw-text-muted)">Checking</span>;
  if (!query.data) return <span className="font-semibold text-(--tanaw-text-secondary)">Could not be checked</span>;
  const status = desktopAppStatus(query.data, now, formatWhen);
  return <span className={appToneClass[status.tone]}>{status.label}</span>;
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-(--tanaw-border-soft) py-3 pr-4 even:pr-0 max-sm:pr-0">
      <dt className="text-[13px] text-(--tanaw-text-muted)">{label}</dt>
      <dd className="mt-0.75 font-semibold wrap-break-word text-(--tanaw-text)">{children}</dd>
    </div>
  );
}
