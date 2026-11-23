import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import type { SupportTicketDetail } from "@/shared/services/supportTickets";
import type { SystemLog } from "@/shared/types";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import {
  buildRequestUpdates,
  formatRequestWhen,
  handledByLabel,
  messageRecipientsLabel,
  progressDotClass,
  progressLabels,
  progressTextClass,
  requestHandler,
  requestStatusNote,
  type AdminRequest,
  type RequestUpdateKind,
} from "../model";
import { MessageItComposer } from "./MessageItComposer";
import { RequestAlertActions } from "./RequestAlertActions";
import { RequestPhotos } from "./RequestPhotos";

type RequestDetailProps = {
  request: AdminRequest;
  logs: readonly SystemLog[];
  ticket: SupportTicketDetail | null;
  ticketLoading: boolean;
  timeFormat: SystemTimeFormat;
  now: Date;
};

const dotBorder: Record<RequestUpdateKind, string> = {
  sent: "border-(--tanaw-action)",
  note: "border-(--tanaw-action)",
  accepted: "border-(--tanaw-accent-ink)",
  resolved: "border-(--tanaw-text-secondary)",
  declined: "border-(--tanaw-danger)",
  review: "border-(--tanaw-warn-ink)",
};

const dotFill: Record<RequestUpdateKind, string> = {
  sent: "bg-(--tanaw-action)",
  note: "bg-(--tanaw-action)",
  accepted: "bg-(--tanaw-accent-ink)",
  resolved: "bg-(--tanaw-text-secondary)",
  declined: "bg-(--tanaw-danger)",
  review: "bg-(--tanaw-warn-ink)",
};

/** The right pane: what happened, the details, the latest updates and the Message IT composer. */
export function RequestDetail({ request, logs, ticket, ticketLoading, timeFormat, now }: RequestDetailProps) {
  const handler = requestHandler(request, logs, ticket);
  const updates = buildRequestUpdates(request, logs, ticket);
  const formatWhen = (value: string | null) => formatRequestWhen(value, now, timeFormat);
  const statusLabel = progressLabels[request.progress];

  return (
    <article aria-labelledby="request-detail-title" className="min-w-0 py-1.5">
      <p className={cn("text-[0.8125rem] font-bold", progressTextClass[request.progress])}>{statusLabel}</p>
      <h2 id="request-detail-title" className="mt-2 font-display text-[1.875rem] leading-[1.15] font-bold text-(--tanaw-text) max-sm:text-2xl">
        {request.title}
      </h2>
      <p className="mt-2.5 flex items-center gap-2 text-[0.90625rem] text-(--tanaw-text-secondary)">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", progressDotClass[request.progress])} />
        {requestStatusNote(request, handler, (value) => formatWhen(value))}
      </p>

      <h3 className="mt-6 text-base font-bold">What happened</h3>
      <p className="mt-1.5 max-w-[68ch] leading-relaxed whitespace-pre-line text-(--tanaw-text-secondary)">{request.what}</p>
      {request.suggestedAction && (
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-(--tanaw-text-secondary)">
          <span className="font-semibold text-(--tanaw-text)">Suggested response: </span>
          {request.suggestedAction}
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
              {request.place}
            </Link>
          ) : (
            request.place
          )}
        </DetailItem>
        <DetailItem label="Type">{request.type}</DetailItem>
        <DetailItem label="Sent by">{request.sentBy}</DetailItem>
        <DetailItem label="Handled by">{handledByLabel(request, handler)}</DetailItem>
        <DetailItem label="Status">{statusLabel}</DetailItem>
        <DetailItem label="Reference number">
          <span className="tabular-nums">{request.reference ?? "Not assigned"}</span>
        </DetailItem>
        {request.area && <DetailItem label="Affected area">{request.area}</DetailItem>}
        {request.camera && <DetailItem label="Camera">{request.camera}</DetailItem>}
      </dl>

      <RequestPhotos attachments={request.attachments} />
      <RequestAlertActions key={request.key} request={request} />

      <h3 className="mt-5.5 text-base font-bold">Latest updates</h3>
      <ol aria-busy={ticketLoading || undefined} className="mt-2.5 list-none pl-2">
        {updates.map((update, index) => (
          <li key={update.id} className="relative border-l-2 border-(--tanaw-border-soft) pb-3.5 pl-5.5 last:pb-1">
            <span
              aria-hidden="true"
              className={cn("absolute top-0.5 -left-1.75 size-3 rounded-full border-2", dotBorder[update.kind], index === 0 ? dotFill[update.kind] : "bg-(--tanaw-page)")}
            />
            <p className={cn("font-bold", update.kind === "declined" ? "text-(--tanaw-danger)" : "text-(--tanaw-text)")}>
              {update.title} {update.at && <span className="text-[0.8125rem] font-medium text-(--tanaw-text-muted)">{formatWhen(update.at)}</span>}
            </p>
            <p className="mt-0.5 text-sm wrap-break-word whitespace-pre-line text-(--tanaw-text-secondary)">{update.detail}</p>
          </li>
        ))}
      </ol>
      {ticketLoading && <p className="mt-1 text-[0.8125rem] text-(--tanaw-text-muted)">Loading the ticket conversation.</p>}

      <MessageItComposer key={request.key} request={request} recipients={messageRecipientsLabel(request, handler)} />
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
