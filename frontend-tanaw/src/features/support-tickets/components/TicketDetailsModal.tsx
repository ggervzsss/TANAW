import { AlertCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { DetailField, EmptyState, ModalFrame } from "@/shared/components/ui";
import { REQUEST_GROUPS, type RequestDetail, type RequestGroup, type RequestStatus } from "@/shared/services/requests";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { useTicketDetails } from "../hooks";
import { formatTicketTime, ticketStatusLabel } from "../model";
import { GroupBadge, TicketStatusBadge, UrgentBadge } from "./TicketBadges";
import { TicketAttachments } from "./TicketAttachments";
import { TicketConversation } from "./TicketConversation";
import { toSentenceCase } from "@/shared/utils/sentenceCase";
import { Badge } from "../../../shared/ui-kit";

type TicketDetailsModalProps = {
  mode: "admin" | "it";
  onClose: () => void;
  ticketId: string;
  timeFormat: SystemTimeFormat;
};

export function TicketDetailsModal({ mode, ticketId, timeFormat, onClose }: TicketDetailsModalProps) {
  const { detailQuery, isReplyPending, isStatusPending, reply, replyError, actionError, setReply, submitReply, updateStatus, reopen, moveToGroup, setUrgent } = useTicketDetails(ticketId);
  const ticket = detailQuery.data;
  const isItResponder = mode === "it";

  return (
    <ModalFrame title={ticket?.title ?? "Request Details"} eyebrow={ticket?.code ?? "Requests"} onClose={onClose} maxWidthClassName="max-w-6xl">
      {!ticket && (
        <EmptyState
          icon={detailQuery.isLoading ? RefreshCw : AlertCircle}
          title={detailQuery.isLoading ? "Loading request details" : "Request unavailable"}
          description={detailQuery.isLoading ? "Fetching the request." : "This request could not be loaded."}
        />
      )}

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
          onUrgentChange={setUrgent}
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

type TicketDetailContentProps = {
  isItResponder: boolean;
  isReplyPending: boolean;
  isStatusPending: boolean;
  onReplyChange: (value: string) => void;
  onReplySubmit: () => void;
  onStatusChange: (status: RequestStatus) => void;
  onReopen: () => void;
  onGroupChange: (group: RequestGroup) => void;
  onUrgentChange: (urgent: boolean) => void;
  actionError: string;
  reply: string;
  replyError: string;
  ticket: RequestDetail;
  timeFormat: SystemTimeFormat;
};

function TicketDetailContent(props: TicketDetailContentProps) {
  const { isItResponder, isReplyPending, isStatusPending, onReplyChange, onReplySubmit, reply, replyError, ticket, timeFormat } = props;
  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-5">
        <TicketSummary ticket={ticket} />
        <div className="grid gap-4 md:grid-cols-2">
          <DetailField label="Sent by" value={ticket.requesterName} />
          <DetailField label="Place" value={ticket.enterpriseName ?? "No TANAW account"} />
          {ticket.enterpriseId ? <DetailField label="Enterprise ID" value={ticket.enterpriseId} /> : null}
          {ticket.requesterEmail ? <DetailField label="Reply to" value={ticket.requesterEmail} /> : null}
          <DetailField label="Group" value={<GroupBadge group={ticket.group} />} />
          <DetailField label="Sent" value={formatTicketTime(ticket.createdAt, timeFormat)} />
          {ticket.affectedArea ? <DetailField label="Affected Area" value={ticket.affectedArea} /> : null}
          {ticket.camera ? <DetailField label="Camera" value={ticket.camera} /> : null}
        </div>
        {ticket.accountChange && <AccountChangePanel ticket={ticket} isItResponder={isItResponder} isPending={isStatusPending} onDecide={props.onStatusChange} />}
        <TicketAttachments attachments={ticket.attachments ?? []} />
      </div>

      <div className="space-y-5">
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
    <div className="rounded-3xl border border-emerald-100 bg-linear-to-br from-emerald-50/80 via-white to-amber-50/60 p-5 dark:border-emerald-300/20 dark:from-[#0f2d3c] dark:via-[#172033] dark:to-[#312638]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold tracking-wide text-emerald-700">{ticket.code}</p>
          <h3 className="mt-1 text-xl font-black text-slate-950">{ticket.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{ticket.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={ticket.status} />
          {ticket.urgent && <UrgentBadge />}
        </div>
      </div>
    </div>
  );
}

const controlButton =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-[#172033] dark:text-slate-200 dark:hover:border-emerald-300/30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-500";

function AccountChangePanel({ ticket, isItResponder, isPending, onDecide }: { ticket: RequestDetail; isItResponder: boolean; isPending: boolean; onDecide: (status: RequestStatus) => void }) {
  const change = ticket.accountChange;
  if (!change) return null;
  const open = ticket.status === "Sent" || ticket.status === "In Progress";
  const waiting = change.verification === "pending_verification" ? "The new address must be verified before you can approve it." : change.verification === "expired" ? "The verification link expired. The enterprise has to ask again." : null;
  return (
    <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
      <h4 className="text-sm font-black tracking-wide text-slate-950 uppercase">Account change</h4>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-slate-500">{change.label}</dt>
          <dd className="font-bold text-slate-950">
            {change.currentValue ?? "Not set"} → {change.requestedValue}
          </dd>
        </div>
      </dl>
      {waiting && <p className="mt-3 text-sm font-semibold text-amber-800 dark:text-amber-200">{waiting}</p>}
      {isItResponder && open && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button type="button" className={controlButton} disabled={!change.canApprove || isPending} onClick={() => onDecide("Approved")}>
            Approve
          </button>
          <button type="button" className={controlButton} disabled={isPending} onClick={() => onDecide("Declined")}>
            Decline
          </button>
        </div>
      )}
    </section>
  );
}

function TicketStatusControl({ isItResponder, isStatusPending: isPending, onStatusChange, onReopen, onGroupChange, onUrgentChange, actionError, ticket }: TicketDetailContentProps) {
  const isAccountChange = Boolean(ticket.accountChange);
  const options: RequestStatus[] = isAccountChange ? ["In Progress"] : ["Sent", "In Progress", "Resolved"];
  const decided = ticket.status === "Approved" || ticket.status === "Declined";
  return (
    <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
          <ShieldCheck size={16} className="text-emerald-700" />
          Request Status
        </h4>
        {!isItResponder && <Badge tone="purple">Read-only</Badge>}
      </div>
      {isItResponder ? (
        <>
          {!decided && ticket.status !== "Resolved" && (
            <div className={`mt-4 grid gap-2 ${options.length === 3 ? "sm:grid-cols-3" : ""}`}>
              {options.map((statusOption) => (
                <button key={statusOption} type="button" disabled={ticket.status === statusOption || isPending} onClick={() => onStatusChange(statusOption)} className={controlButton}>
                  {toSentenceCase(ticketStatusLabel(statusOption))}
                </button>
              ))}
            </div>
          )}
          {ticket.status === "Resolved" && (
            <button type="button" disabled={isPending} onClick={onReopen} className={`mt-4 w-full ${controlButton}`}>
              Reopen request
            </button>
          )}
          {!isAccountChange && (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-black tracking-wide text-slate-500 uppercase">Group</span>
              <select
                value={ticket.group}
                disabled={isPending}
                onChange={(event) => onGroupChange(event.target.value as RequestGroup)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 dark:border-slate-700 dark:bg-[#172033] dark:text-slate-100"
              >
                {REQUEST_GROUPS.filter((group) => group !== "Account change").map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={ticket.urgent} disabled={isPending} onChange={(event) => onUrgentChange(event.target.checked)} />
            Urgent
          </label>
          {actionError && <p className="mt-2 text-xs font-bold text-red-700">{actionError}</p>}
        </>
      ) : (
        <p className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 dark:border-indigo-300/25 dark:bg-indigo-500/10 dark:text-indigo-200">
          IT handles requests. You can read this request and its conversation.
        </p>
      )}
    </section>
  );
}
