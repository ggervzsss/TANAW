import { AlertCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { DetailField, EmptyState, ModalFrame } from "@/shared/components/ui";
import type { SupportTicketDetail, SupportTicketStatus } from "@/shared/services/supportTickets";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { useTicketDetails } from "../hooks";
import { formatTicketTime, ticketStatusLabel } from "../model";
import { CategoryBadge, PriorityBadge, TicketStatusBadge } from "./TicketBadges";
import { TicketAttachments } from "./TicketAttachments";
import { TicketConversation } from "./TicketConversation";

type TicketDetailsModalProps = {
  mode: "admin" | "it";
  onClose: () => void;
  ticketId: string;
  timeFormat: SystemTimeFormat;
};

export function TicketDetailsModal({ mode, ticketId, timeFormat, onClose }: TicketDetailsModalProps) {
  const { detailQuery, isReplyPending, isStatusPending, reply, replyError, setReply, submitReply, updateStatus } = useTicketDetails(ticketId);
  const ticket = detailQuery.data;
  const isItResponder = mode === "it";

  return (
    <ModalFrame title={ticket?.subject ?? "Support Request Details"} eyebrow={ticket?.code ?? "Support Requests"} onClose={onClose} maxWidthClassName="max-w-6xl">
      {!ticket && (
        <EmptyState
          icon={detailQuery.isLoading ? RefreshCw : AlertCircle}
          title={detailQuery.isLoading ? "Loading request details" : "Request unavailable"}
          description={detailQuery.isLoading ? "Fetching support request data." : "This request could not be loaded."}
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
  onStatusChange: (status: SupportTicketStatus) => void;
  reply: string;
  replyError: string;
  ticket: SupportTicketDetail;
  timeFormat: SystemTimeFormat;
};

function TicketDetailContent(props: TicketDetailContentProps) {
  const { isItResponder, isReplyPending, isStatusPending, onReplyChange, onReplySubmit, onStatusChange, reply, replyError, ticket, timeFormat } = props;
  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-5">
        <TicketSummary ticket={ticket} />
        <div className="grid gap-4 md:grid-cols-2">
          <DetailField label="Requester" value={ticket.enterpriseName} />
          <DetailField label="Account ID" value={ticket.enterpriseId} />
          <DetailField label="Category" value={<CategoryBadge category={ticket.category} />} />
          <DetailField label="Submitted" value={formatTicketTime(ticket.createdAt, timeFormat)} />
          {ticket.affectedArea ? <DetailField label="Affected Area" value={ticket.affectedArea} /> : null}
          {ticket.cameraNode ? <DetailField label="Camera" value={ticket.cameraNode} /> : null}
        </div>
        <TicketAttachments attachments={ticket.attachments} />
      </div>

      <div className="space-y-5">
        <TicketStatusControl isItResponder={isItResponder} isPending={isStatusPending} status={ticket.status} onStatusChange={onStatusChange} />
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

function TicketSummary({ ticket }: { ticket: SupportTicketDetail }) {
  return (
    <div className="rounded-3xl border border-emerald-100 bg-linear-to-br from-emerald-50/80 via-white to-amber-50/60 p-5 dark:border-emerald-300/20 dark:from-[#0f2d3c] dark:via-[#172033] dark:to-[#312638]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold tracking-wide text-emerald-700">{ticket.code}</p>
          <h3 className="mt-1 text-xl font-black text-slate-950">{ticket.subject}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{ticket.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
        </div>
      </div>
    </div>
  );
}

function TicketStatusControl({
  isItResponder,
  isPending,
  onStatusChange,
  status,
}: {
  isItResponder: boolean;
  isPending: boolean;
  onStatusChange: (status: SupportTicketStatus) => void;
  status: SupportTicketStatus;
}) {
  return (
    <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
          <ShieldCheck size={16} className="text-emerald-700" />
          Request Status
        </h4>
        {!isItResponder && <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black text-indigo-700 uppercase">Read-only</span>}
      </div>
      {isItResponder ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(["Open", "In Review", "Resolved"] as SupportTicketStatus[]).map((statusOption) => (
            <button
              key={statusOption}
              type="button"
              disabled={status === statusOption || isPending}
              onClick={() => onStatusChange(statusOption)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 uppercase transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-[#172033] dark:text-slate-200 dark:hover:border-emerald-300/30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {ticketStatusLabel(statusOption)}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 dark:border-indigo-300/25 dark:bg-indigo-500/10 dark:text-indigo-200">
          Admin supervision can inspect this ticket and communication history. IT personnel handle responses and workflow changes.
        </p>
      )}
    </section>
  );
}
