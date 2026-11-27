import { AlertCircle, ShieldCheck } from "lucide-react";
import { DetailField, EmptyState, ModalFrame } from "@/shared/components/ui";
import { REQUEST_GROUPS, type RequestDetail, type RequestGroup, type RequestStatus } from "@/shared/services/requests";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { useTicketDetails } from "../hooks";
import { formatTicketTime, ticketStatusLabel } from "../model";
import { GroupBadge, TicketStatusBadge } from "./TicketBadges";
import { TicketAttachments } from "./TicketAttachments";
import { TicketConversation } from "./TicketConversation";
import { toSentenceCase } from "@/shared/utils/sentenceCase";
import { Badge, Button, Skeleton, controlClassName } from "../../../shared/ui-kit";
import "../supportTickets.css";

type TicketDetailsModalProps = {
  mode: "admin" | "it";
  onClose: () => void;
  ticketId: string;
  timeFormat: SystemTimeFormat;
};

/** A section heading inside the request window: Inter 650, sentence case. */
export const ticketSectionHeading = "flex items-center gap-2 text-[0.9375rem] font-[650] text-(--tanaw-text)";

export function TicketDetailsModal({ mode, ticketId, timeFormat, onClose }: TicketDetailsModalProps) {
  const { detailQuery, isReplyPending, isStatusPending, reply, replyError, actionError, setReply, submitReply, updateStatus, reopen, moveToGroup } = useTicketDetails(ticketId);
  const ticket = detailQuery.data;
  const isItResponder = mode === "it";

  return (
    <ModalFrame title={ticket?.title ?? "Request Details"} eyebrow={ticket?.code ?? "Requests"} onClose={onClose} maxWidthClassName="max-w-6xl">
      {!ticket && detailQuery.isLoading && <TicketDetailSkeleton />}
      {!ticket && !detailQuery.isLoading && <EmptyState icon={AlertCircle} title="Request unavailable" description="This request could not be loaded." />}

      {ticket && (
        <TicketDetailContent
          isItResponder={isItResponder}
          isReplyPending={isReplyPending}
          isStatusPending={isStatusPending}
          onReplyChange={setReply}
          onReplySubmit={submitReply}
          onStatusChange={updateStatus}
          onReopen={reopen}
          onGroupChange={moveToGroup}
          actionError={actionError}
          reply={reply}
          replyError={replyError}
          ticket={ticket}
          timeFormat={timeFormat}
        />
      )}
    </ModalFrame>
  );
}

/** The request window's shape while the request loads. */
function TicketDetailSkeleton() {
  return (
    // The same two columns and hairline-split sections as TicketDetailContent, at its line heights.
    <div role="status" aria-label="Loading request details" className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
      <div aria-hidden="true" className="min-w-0">
        <div className="support-tickets__section flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="flex h-[19.5px] items-center">
              <Skeleton className="h-3 w-24" />
            </span>
            <span className="mt-1 flex h-[1.72rem] items-center">
              <Skeleton className="h-5 w-3/5" />
            </span>
            <span className="mt-2 flex h-[1.42rem] items-center">
              <Skeleton className="h-3.5 w-full max-w-3xl" />
            </span>
            <span className="flex h-[1.42rem] items-center">
              <Skeleton className="h-3.5 w-4/5 max-w-2xl" />
            </span>
          </div>
          <Skeleton shape="pill" className="h-6.5 w-24 shrink-0" />
        </div>
        <div className="support-tickets__section grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="border-b border-(--tanaw-border-soft) py-3">
              <span className="mb-1 flex h-[19.5px] items-center">
                <Skeleton className="h-3 w-20" />
              </span>
              <span className="flex h-[1.42rem] items-center">
                <Skeleton className="h-3.5 w-2/3" />
              </span>
            </div>
          ))}
        </div>
        <div className="support-tickets__section">
          <span className="flex h-[1.41rem] items-center justify-between gap-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-16" />
          </span>
          <span className="mt-3 flex h-5 items-center">
            <Skeleton className="h-3.5 w-3/5" />
          </span>
        </div>
      </div>
      <div aria-hidden="true" className="min-w-0 xl:border-l xl:border-(--tanaw-border-soft) xl:pl-8">
        <div className="support-tickets__section">
          <span className="flex h-[1.41rem] items-center">
            <Skeleton className="h-4 w-32" />
          </span>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-8.5 w-full rounded-tanaw-md" />
            <Skeleton className="h-8.5 w-full rounded-tanaw-md" />
          </div>
          <span className="mt-4 mb-1.5 flex h-[19.5px] items-center">
            <Skeleton className="h-3 w-12" />
          </span>
          <Skeleton className="h-10 w-full rounded-tanaw-md" />
        </div>
        <div className="support-tickets__section">
          <span className="flex h-[1.41rem] items-center">
            <Skeleton className="h-4 w-28" />
          </span>
          <Skeleton className="mt-4 h-20 w-full rounded-tanaw-md" />
        </div>
      </div>
    </div>
  );
}

type TicketDetailContentProps = {
  isItResponder: boolean;
  isReplyPending: boolean;
  isStatusPending: boolean;
  onReplyChange: (value: string) => void;
  onReplySubmit: () => void;
  onStatusChange: (status: RequestStatus) => void;
  onReopen: () => void;
  onGroupChange: (group: RequestGroup) => void;
  actionError: string;
  reply: string;
  replyError: string;
  ticket: RequestDetail;
  timeFormat: SystemTimeFormat;
};

function TicketDetailContent(props: TicketDetailContentProps) {
  const { isItResponder, isReplyPending, onReplyChange, onReplySubmit, reply, replyError, ticket, timeFormat } = props;
  return (
    <div className="tanaw-enter grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="min-w-0">
        <TicketSummary ticket={ticket} />
        <div className="support-tickets__section grid gap-4 md:grid-cols-2">
          <DetailField label="Sent by" value={ticket.requesterName} />
          <DetailField label="Place" value={ticket.enterpriseName ?? "No TANAW account"} />
          {ticket.enterpriseId ? <DetailField label="Enterprise ID" value={ticket.enterpriseId} /> : null}
          {ticket.requesterEmail ? <DetailField label="Reply to" value={ticket.requesterEmail} /> : null}
          <DetailField label="Group" value={<GroupBadge group={ticket.group} />} />
          <DetailField label="Sent" value={formatTicketTime(ticket.createdAt, timeFormat)} />
          {ticket.affectedArea ? <DetailField label="Affected Area" value={ticket.affectedArea} /> : null}
          {ticket.camera ? <DetailField label="Camera" value={ticket.camera} /> : null}
        </div>
        {ticket.accountChange && <AccountChangePanel ticket={ticket} isItResponder={isItResponder} isPending={props.isStatusPending} onDecide={props.onStatusChange} />}
        <TicketAttachments attachments={ticket.attachments ?? []} />
      </div>

      <div className="min-w-0 xl:border-l xl:border-(--tanaw-border-soft) xl:pl-8">
        <TicketStatusControl {...props} />
        <TicketConversation
          isItResponder={isItResponder}
          isReplyPending={isReplyPending}
          onReplyChange={onReplyChange}
          onReplySubmit={onReplySubmit}
          reply={reply}
          replyError={replyError}
          ticket={ticket}
          timeFormat={timeFormat}
        />
      </div>
    </div>
  );
}

function TicketSummary({ ticket }: { ticket: RequestDetail }) {
  return (
    <div className="support-tickets__section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[13px] font-semibold text-(--tanaw-accent-ink)">{ticket.code}</p>
          <h3 className="mt-1 text-xl leading-snug font-[650] tracking-[-0.01em] text-(--tanaw-text)">{ticket.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-(--tanaw-text-secondary)">{ticket.description}</p>
        </div>
        <TicketStatusBadge status={ticket.status} />
      </div>
    </div>
  );
}

function AccountChangePanel({ ticket, isItResponder, isPending, onDecide }: { ticket: RequestDetail; isItResponder: boolean; isPending: boolean; onDecide: (status: RequestStatus) => void }) {
  const change = ticket.accountChange;
  if (!change) return null;
  const open = ticket.status === "In Progress";
  const waiting = change.verification === "pending_verification" ? "The new address must be verified before you can approve it." : change.verification === "expired" ? "The verification link expired. The enterprise has to ask again." : null;
  return (
    <section className="support-tickets__section">
      <h4 className={ticketSectionHeading}>Account change</h4>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-(--tanaw-text-muted)">{change.label}</dt>
          <dd className="font-semibold text-(--tanaw-text)">
            {change.currentValue ?? "Not set"} → {change.requestedValue}
          </dd>
        </div>
      </dl>
      {waiting && <p className="mt-3 text-sm font-medium text-(--tanaw-warn-ink)">{waiting}</p>}
      {isItResponder && open && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" size="sm" disabled={!change.canApprove || isPending} onClick={() => onDecide("Approved")}>
            Approve
          </Button>
          <Button variant="secondary" size="sm" disabled={isPending} onClick={() => onDecide("Resolved")}>
            Resolve without approving
          </Button>
        </div>
      )}
    </section>
  );
}

function TicketStatusControl({ isItResponder, isStatusPending: isPending, onStatusChange, onReopen, onGroupChange, actionError, ticket }: TicketDetailContentProps) {
  // An account change is approved or resolved from its own panel, and stays closed once decided.
  const isAccountChange = Boolean(ticket.accountChange);
  const options: RequestStatus[] = ["In Progress", "Resolved"];
  return (
    <section className="support-tickets__section">
      <div className="flex items-center justify-between gap-3">
        <h4 className={ticketSectionHeading}>
          <ShieldCheck size={16} aria-hidden="true" className="text-(--tanaw-accent-ink)" />
          Request Status
        </h4>
        {!isItResponder && <Badge tone="purple">Read-only</Badge>}
      </div>
      {isItResponder ? (
        <>
          {isAccountChange && (
            <p className="mt-4 text-sm text-(--tanaw-text-secondary)">
              {ticket.status === "In Progress" ? "Approve this change, or resolve it without approving, under Account change." : "This account change is decided."}
            </p>
          )}
          {!isAccountChange && ticket.status === "In Progress" && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {options.map((statusOption) => (
                <Button key={statusOption} variant="secondary" size="sm" disabled={ticket.status === statusOption || isPending} onClick={() => onStatusChange(statusOption)}>
                  {toSentenceCase(ticketStatusLabel(statusOption))}
                </Button>
              ))}
            </div>
          )}
          {!isAccountChange && ticket.status === "Resolved" && (
            <Button variant="secondary" size="sm" fullWidth disabled={isPending} onClick={onReopen} className="mt-4">
              Reopen request
            </Button>
          )}
          {!isAccountChange && (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">Group</span>
              <select
                value={ticket.group}
                disabled={isPending}
                onChange={(event) => onGroupChange(event.target.value as RequestGroup)}
                className={`${controlClassName} h-10 w-full px-3 text-sm`}
              >
                {REQUEST_GROUPS.filter((group) => group !== "Account change").map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>
          )}
          {actionError && <p className="mt-2 text-[13px] font-medium text-(--tanaw-error)">{actionError}</p>}
        </>
      ) : (
        <p className="rounded-tanaw-md mt-4 bg-(--tanaw-surface-inset) px-4 py-3 text-sm text-(--tanaw-text-secondary)">IT handles requests. You can read this request and its conversation.</p>
      )}
    </section>
  );
}
