import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import type { Request, RequestDetail as RequestTimeline } from "@/shared/services/requests";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import {
  accountChangeSentence,
  buildRequestUpdates,
  formatRequestWhen,
  handledByLabel,
  requestHandler,
  requestPlace,
  requestStatusNote,
  statusDotClass,
  statusLabels,
  statusTextClass,
  type RequestUpdateKind,
} from "../model";
import { NoteForItComposer } from "./NoteForItComposer";
import { RequestPhotos } from "./RequestPhotos";

type RequestDetailProps = {
  request: Request;
  detail: RequestTimeline | null;
  detailLoading: boolean;
  timeFormat: SystemTimeFormat;
  now: Date;
};

const dotBorder: Record<RequestUpdateKind, string> = {
  sent: "border-(--tanaw-action)",
  note: "border-(--tanaw-action)",
  accepted: "border-(--tanaw-accent-ink)",
  resolved: "border-(--tanaw-text-secondary)",
  review: "border-(--tanaw-warn-ink)",
};

const dotFill: Record<RequestUpdateKind, string> = {
  sent: "bg-(--tanaw-action)",
  note: "bg-(--tanaw-action)",
  accepted: "bg-(--tanaw-accent-ink)",
  resolved: "bg-(--tanaw-text-secondary)",
  review: "bg-(--tanaw-warn-ink)",
};

/** The right pane: what happened, the details, the latest updates and the note for IT. */
export function RequestDetail({ request, detail, detailLoading, timeFormat, now }: RequestDetailProps) {
  const handler = requestHandler(detail);
  const updates = buildRequestUpdates(request, detail);
  const formatWhen = (value: string | null) => formatRequestWhen(value, now, timeFormat);
  const statusLabel = statusLabels[request.status];
  const change = accountChangeSentence(request);
  const place = requestPlace(request);
  const sentBy = request.enterpriseName ? `${request.requesterName}, ${request.enterpriseName}` : request.requesterName;

  return (
    <article aria-labelledby="request-detail-title" className="min-w-0 py-1.5">
      <p className={cn("text-[0.8125rem] font-bold", statusTextClass[request.status])}>{statusLabel}</p>
      <h2 id="request-detail-title" className="mt-2 font-display text-[1.875rem] leading-[1.15] font-bold text-(--tanaw-text) max-sm:text-2xl">
        {request.title}
      </h2>
      <p className="mt-2.5 flex items-center gap-2 text-[0.90625rem] text-(--tanaw-text-secondary)">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", statusDotClass[request.status])} />
        {requestStatusNote(request, handler, (value) => formatWhen(value))}
      </p>

      <h3 className="mt-6 text-base font-bold">What happened</h3>
      <p className="mt-1.5 max-w-[68ch] leading-relaxed whitespace-pre-line text-(--tanaw-text-secondary)">{request.description}</p>
      {change && (
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-(--tanaw-text-secondary)">
          <span className="font-semibold text-(--tanaw-text)">Change asked for: </span>
          {change}
        </p>
      )}

      <h3 className="mt-5.5 text-base font-bold">Details</h3>
      <dl className="mt-2 grid grid-cols-2 border-t border-(--tanaw-border-soft) max-sm:grid-cols-1">
        <DetailItem label="Location">
          {request.enterpriseId ? (
            <Link
              to={adminEnterpriseDetailsPath(request.enterpriseId)}
              className="rounded-sm text-(--tanaw-accent-ink) no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
            >
              {place}
            </Link>
          ) : (
            place
          )}
        </DetailItem>
        <DetailItem label="Type">{request.group}</DetailItem>
        <DetailItem label="Sent by">{sentBy}</DetailItem>
        <DetailItem label="Handled by">{handledByLabel(handler)}</DetailItem>
        <DetailItem label="Status">{statusLabel}</DetailItem>
        <DetailItem label="Reference number">
          <span className="tabular-nums">{request.code}</span>
        </DetailItem>
        {request.requesterEmail && <DetailItem label="Reply to">{request.requesterEmail}</DetailItem>}
        {request.affectedArea && <DetailItem label="Affected area">{request.affectedArea}</DetailItem>}
        {request.camera && <DetailItem label="Camera">{request.camera}</DetailItem>}
      </dl>

      <RequestPhotos attachments={request.attachments ?? []} />

      <h3 className="mt-5.5 text-base font-bold">Latest updates</h3>
      <ol aria-busy={detailLoading || undefined} className="mt-2.5 list-none pl-2">
        {updates.map((update, index) => (
          <li key={update.id} className="relative border-l-2 border-(--tanaw-border-soft) pb-3.5 pl-5.5 last:pb-1">
            <span
              aria-hidden="true"
              className={cn("absolute top-0.5 -left-1.75 size-3 rounded-full border-2", dotBorder[update.kind], index === 0 ? dotFill[update.kind] : "bg-(--tanaw-page)")}
            />
            <p className="font-bold text-(--tanaw-text)">
              {update.title} {update.at && <span className="text-[0.8125rem] font-medium text-(--tanaw-text-muted)">{formatWhen(update.at)}</span>}
            </p>
            <p className="mt-0.5 text-sm wrap-break-word whitespace-pre-line text-(--tanaw-text-secondary)">{update.detail}</p>
          </li>
        ))}
      </ol>
      {detailLoading && <p className="mt-1 text-[0.8125rem] text-(--tanaw-text-muted)">Loading the request's updates.</p>}

      <NoteForItComposer key={request.id} request={request} recipients={handler.name ? `${handler.name} and the IT team` : "the IT team"} />
    </article>
  );
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-(--tanaw-border-soft) py-3 pr-4 even:pr-0 max-sm:pr-0">
      <dt className="text-[0.78125rem] text-(--tanaw-text-muted)">{label}</dt>
      <dd className="mt-0.75 font-bold wrap-break-word text-(--tanaw-text)">{children}</dd>
    </div>
  );
}
