import { AlertCircle, Clock3, Eye, ImageIcon, MessageSquare, Paperclip, RefreshCw, Search, Send, ShieldCheck, TicketCheck } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { DetailField, EmptyState, FilterSelect, ModalFrame, PageMotion } from "@/shared/components/ui";
import {
  fetchSupportTicketAttachmentBlob,
  getSupportTicket,
  isSafeSupportTicketImage,
  listSupportTickets,
  replyToSupportTicket,
  updateSupportTicketStatus,
  type SupportTicket,
  type SupportTicketAttachment,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@/shared/services/supportTickets";

type SupportTicketsPageProps = {
  mode: "admin" | "it";
};

type StatusFilter = "All Statuses" | SupportTicketStatus;
type PriorityFilter = "All Priorities" | SupportTicketPriority;
type CategoryFilter = "All Categories" | SupportTicketCategory;

const ticketQueryKey = ["operational", "support-tickets"];
const statuses: StatusFilter[] = ["All Statuses", "Open", "In Review", "Resolved"];
const priorities: PriorityFilter[] = ["All Priorities", "Urgent", "High", "Normal", "Low"];
const categories: CategoryFilter[] = ["All Categories", "Camera Issue", "Report Concern", "Maintenance", "Account & Security", "Other"];
const EMPTY_SUPPORT_TICKETS: SupportTicket[] = [];

export function SupportTicketsPage({ mode }: SupportTicketsPageProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All Statuses");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("All Priorities");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All Categories");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const isItResponder = mode === "it";
  const ticketsQuery = useQuery({
    queryKey: ticketQueryKey,
    queryFn: listSupportTickets,
    refetchInterval: 30_000,
  });

  const tickets = ticketsQuery.data ?? EMPTY_SUPPORT_TICKETS;
  const filteredTickets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const searchable = [
        ticket.code,
        ticket.enterpriseName,
        ticket.enterpriseId,
        ticket.subject,
        ticket.description,
        ticket.category,
        ticket.priority,
        ticket.status,
        ticket.affectedArea ?? "",
        ticket.cameraNode ?? "",
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesStatus = statusFilter === "All Statuses" || ticket.status === statusFilter;
      const matchesPriority = priorityFilter === "All Priorities" || ticket.priority === priorityFilter;
      const matchesCategory = categoryFilter === "All Categories" || ticket.category === categoryFilter;
      return matchesQuery && matchesStatus && matchesPriority && matchesCategory;
    });
  }, [categoryFilter, priorityFilter, query, statusFilter, tickets]);

  const activeTickets = tickets.filter((ticket) => ticket.status !== "Resolved");
  const urgentTickets = tickets.filter((ticket) => ticket.priority === "Urgent" || ticket.priority === "High");
  const inReviewTickets = tickets.filter((ticket) => ticket.status === "In Review");
  const ticketsWithAttachments = tickets.filter((ticket) => ticket.attachments.length > 0);
  const routeTicketId = searchParams.get("ticket");
  const activeTicketId = routeTicketId ?? selectedTicketId;

  const openTicketDetails = (ticketId: string) => {
    setSelectedTicketId(ticketId);
    if (!routeTicketId) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("ticket");
    setSearchParams(nextParams, { replace: true });
  };

  const closeTicketDetails = () => {
    setSelectedTicketId(null);
    if (!routeTicketId) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("ticket");
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <PageMotion>
      <PageHeader
        title="Support Tickets"
        description={
          isItResponder
            ? "Technical inbox for TANAW support requests, attachments, and IT responses."
            : "Read-only supervision for TANAW support requests, IT responses, and ticket status."
        }
      />

      {!isItResponder && (
        <div className="mb-5 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 dark:border-indigo-300/25 dark:bg-indigo-500/10 dark:text-indigo-200">
          IT personnel handle user responses. Admin can monitor ticket status, attachments, and communication.
        </div>
      )}

      <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <MetricCard label="Active Tickets" value={activeTickets.length} foot="Open or in review" color="#065f46" icon={TicketCheck} />
        <MetricCard label="High Priority" value={urgentTickets.length} foot="High or urgent queue" color="#b45309" footClassName="text-amber-700" icon={AlertCircle} />
        <MetricCard label="In Review" value={inReviewTickets.length} foot="Currently handled by IT" color="#2563eb" footClassName="text-blue-700" icon={Clock3} />
        <MetricCard label="With Photos" value={ticketsWithAttachments.length} foot="Attachment-backed tickets" color="#0f766e" icon={ImageIcon} />
      </section>

      <Panel className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search ticket ID, enterprise, subject, category, or status"
              className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
            />
          </div>
          <FilterSelect value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={statuses} />
          <FilterSelect value={priorityFilter} onChange={(value) => setPriorityFilter(value as PriorityFilter)} options={priorities} />
          <FilterSelect value={categoryFilter} onChange={(value) => setCategoryFilter(value as CategoryFilter)} options={categories} />
          <button
            type="button"
            onClick={() => void ticketsQuery.refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs font-black tracking-wide text-emerald-700 uppercase shadow-sm transition hover:bg-emerald-50"
          >
            <RefreshCw size={14} className={ticketsQuery.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-260 table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[18%]" />
              <col className="w-[24%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
              <tr>
                {["Ticket ID", "Enterprise", "Subject", "Category", "Priority", "Status", "Submitted"].map((heading) => (
                  <th key={heading} className="px-4 py-4 whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {filteredTickets.map((ticket) => (
                <tr key={ticket.id} onClick={() => openTicketDetails(ticket.id)} className="group hover:bg-tgreen-dark/5 cursor-pointer transition">
                  <td className="px-4 py-4 align-top font-mono text-xs font-bold text-emerald-700">{ticket.code}</td>
                  <td className="px-4 py-4 align-top">
                    <p className="font-bold text-gray-950">{ticket.enterpriseName}</p>
                    <p className="mt-1 font-mono text-[10px] font-semibold wrap-break-word text-gray-500">{ticket.enterpriseId}</p>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <p className="font-bold text-gray-950">{ticket.subject}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">{ticket.description}</p>
                    {ticket.attachments.length > 0 && (
                      <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                        <Paperclip size={11} />
                        {ticket.attachments.length} photo{ticket.attachments.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <CategoryBadge category={ticket.category} />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <TicketStatusBadge status={ticket.status} />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <p className="text-[11px] font-bold text-gray-500 uppercase">{formatTicketTime(ticket.createdAt)}</p>
                    <button type="button" className="mt-2 inline-flex items-center gap-1 text-[10px] font-black tracking-wide text-emerald-700 uppercase">
                      <Eye size={12} />
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
              {filteredTickets.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={TicketCheck}
                      title={ticketsQuery.isLoading ? "Loading support tickets" : "No support tickets"}
                      description={ticketsQuery.isLoading ? "Fetching enterprise ticket records." : "Enterprise-submitted tickets will appear here for review."}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
          <span>Showing {filteredTickets.length} tickets</span>
          <span>{isItResponder ? "IT response queue" : "Read-only supervision"}</span>
        </div>
      </Panel>

      <AnimatePresence>
        {activeTicketId && <TicketDetailsModal mode={mode} ticketId={activeTicketId} onClose={closeTicketDetails} />}
      </AnimatePresence>
    </PageMotion>
  );
}

function TicketDetailsModal({ mode, ticketId, onClose }: { mode: "admin" | "it"; ticketId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<SupportTicketAttachment | null>(null);
  const isItResponder = mode === "it";
  const detailQuery = useQuery({
    queryKey: [...ticketQueryKey, ticketId],
    queryFn: () => getSupportTicket(ticketId),
  });
  const ticket = detailQuery.data;
  const replyMutation = useMutation({
    mutationFn: (message: string) => replyToSupportTicket(ticketId, message),
    onSuccess: (detail) => {
      queryClient.setQueryData([...ticketQueryKey, ticketId], detail);
      void queryClient.invalidateQueries({ queryKey: ticketQueryKey });
      setReply("");
      setReplyError("");
    },
    onError: () => setReplyError("Unable to send reply. Please try again."),
  });
  const statusMutation = useMutation({
    mutationFn: (status: SupportTicketStatus) => updateSupportTicketStatus(ticketId, status),
    onSuccess: (detail) => {
      queryClient.setQueryData([...ticketQueryKey, ticketId], detail);
      void queryClient.invalidateQueries({ queryKey: ticketQueryKey });
    },
  });

  const handleReplySubmit = () => {
    const trimmed = reply.trim();
    if (!trimmed) {
      setReplyError("Enter a response before sending.");
      return;
    }
    replyMutation.mutate(trimmed);
  };

  return (
    <>
      <ModalFrame title={ticket?.subject ?? "Support Ticket Details"} eyebrow={ticket?.code ?? "Support Tickets"} onClose={onClose} maxWidthClassName="max-w-6xl">
        {!ticket && (
          <EmptyState
            icon={detailQuery.isLoading ? RefreshCw : AlertCircle}
            title={detailQuery.isLoading ? "Loading ticket details" : "Ticket unavailable"}
            description={detailQuery.isLoading ? "Fetching support ticket data." : "This ticket could not be loaded."}
          />
        )}

        {ticket && (
          <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
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

              <div className="grid gap-4 md:grid-cols-2">
                <DetailField label="Requester" value={ticket.enterpriseName} />
                <DetailField label="Account ID" value={ticket.enterpriseId} />
                <DetailField label="Category" value={<CategoryBadge category={ticket.category} />} />
                <DetailField label="Submitted" value={formatTicketTime(ticket.createdAt)} />
                <DetailField label="Affected Area" value={ticket.affectedArea || "Not specified"} />
                <DetailField label="Camera Node" value={ticket.cameraNode || "Not specified"} />
              </div>

              <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
                    <Paperclip size={16} className="text-emerald-700" />
                    Photos
                  </h4>
                  <span className="text-[11px] font-bold text-slate-400 uppercase">{ticket.attachments.length} attached</span>
                </div>
                {ticket.attachments.length > 0 ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {ticket.attachments.map((attachment, index) => (
                      <button
                        key={attachment.id ?? `${attachment.fileName}-${index}`}
                        type="button"
                        onClick={() => setPreviewAttachment(attachment)}
                        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50 dark:border-slate-700 dark:bg-[#0f172a] dark:hover:border-emerald-300/30 dark:hover:bg-emerald-500/10"
                      >
                        <TicketAttachmentImage attachment={attachment} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-slate-200" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-slate-950">{attachment.fileName}</span>
                          <span className="mt-1 block text-[11px] font-semibold text-slate-500">{formatFileSize(attachment.sizeBytes)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">No photos were attached to this ticket.</p>
                )}
              </section>
            </div>

            <div className="space-y-5">
              <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
                    <ShieldCheck size={16} className="text-emerald-700" />
                    Workflow
                  </h4>
                  {!isItResponder && <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black text-indigo-700 uppercase">Read-only</span>}
                </div>
                {isItResponder ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {(["Open", "In Review", "Resolved"] as SupportTicketStatus[]).map((statusOption) => (
                      <button
                        key={statusOption}
                        type="button"
                        disabled={ticket.status === statusOption || statusMutation.isPending}
                        onClick={() => statusMutation.mutate(statusOption)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 uppercase transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-[#172033] dark:text-slate-200 dark:hover:border-emerald-300/30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                      >
                        {statusOption}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 dark:border-indigo-300/25 dark:bg-indigo-500/10 dark:text-indigo-200">
                    Admin supervision can inspect this ticket and communication history. IT personnel handle responses and workflow changes.
                  </p>
                )}
              </section>

              <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
                <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
                  <MessageSquare size={16} className="text-emerald-700" />
                  Conversation
                </h4>
                <div className="mt-4 space-y-3">
                  <ConversationItem
                    authorName={ticket.submittedBy}
                    authorRole="requester"
                    createdAt={ticket.createdAt}
                    message={ticket.description}
                  />
                  {ticket.messages.map((message) => (
                    <ConversationItem key={message.id} authorName={message.authorName} authorRole={message.authorRole} createdAt={message.createdAt} message={message.message} />
                  ))}
                </div>

                {isItResponder ? (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-black tracking-wide text-slate-500 uppercase">IT Response</span>
                      <textarea
                        value={reply}
                        onChange={(event) => {
                          setReply(event.target.value);
                          setReplyError("");
                        }}
                        rows={4}
                        placeholder="Write a response for the requester..."
                        className="w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                      />
                    </label>
                    {replyError && <p className="mt-2 text-xs font-bold text-red-700">{replyError}</p>}
                    <button
                      type="button"
                      onClick={handleReplySubmit}
                      disabled={replyMutation.isPending}
                      className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700/60"
                    >
                      {replyMutation.isPending ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                      {replyMutation.isPending ? "Sending..." : "Send Reply"}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        )}
      </ModalFrame>

      <AnimatePresence>
        {previewAttachment && (
          <ModalFrame title={previewAttachment.fileName} eyebrow="Ticket Photo" onClose={() => setPreviewAttachment(null)} maxWidthClassName="max-w-4xl">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
              <TicketAttachmentImage attachment={previewAttachment} alt={previewAttachment.fileName} className="max-h-[70vh] w-full rounded-2xl object-contain" isFullPreview />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-semibold text-slate-500">
                <span className="truncate">{previewAttachment.fileName}</span>
                <span>{formatFileSize(previewAttachment.sizeBytes)}</span>
              </div>
            </div>
          </ModalFrame>
        )}
      </AnimatePresence>
    </>
  );
}

function TicketAttachmentImage({ alt, attachment, className, isFullPreview = false }: { alt: string; attachment: SupportTicketAttachment; className: string; isFullPreview?: boolean }) {
  const { error, imageUrl, isLoading } = useTicketAttachmentImageUrl(attachment);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const renderError = imageUrl && failedImageUrl === imageUrl ? "Image could not be rendered" : "";

  if (!isSafeSupportTicketImage(attachment)) {
    return <AttachmentImageFallback className={className} isFullPreview={isFullPreview} message="Unsupported image type" />;
  }

  if (error || renderError) {
    return <AttachmentImageFallback className={className} isFullPreview={isFullPreview} message={renderError || error || "Image could not be loaded"} />;
  }

  if (isLoading || !imageUrl) {
    return <AttachmentImageFallback className={className} icon="loading" isFullPreview={isFullPreview} message="Loading image" />;
  }

  return <img src={imageUrl} alt={alt} className={className} onError={() => setFailedImageUrl(imageUrl)} />;
}

function AttachmentImageFallback({ className, icon = "error", isFullPreview, message }: { className: string; icon?: "error" | "loading"; isFullPreview: boolean; message: string }) {
  return (
    <div className={`${className} flex ${isFullPreview ? "min-h-72" : ""} items-center justify-center border border-dashed border-slate-200 bg-white text-center text-slate-500 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-300`}>
      <span className="flex max-w-full flex-col items-center gap-2 px-3">
        {icon === "loading" ? <RefreshCw size={isFullPreview ? 28 : 18} className="animate-spin text-emerald-700" /> : <ImageIcon size={isFullPreview ? 30 : 18} className="text-slate-400" />}
        {isFullPreview && <span className="text-sm font-semibold">{message}</span>}
      </span>
    </div>
  );
}

function useTicketAttachmentImageUrl(attachment: SupportTicketAttachment) {
  const attachmentKey = getAttachmentPreviewKey(attachment);
  const [state, setState] = useState<{ attachmentKey: string; error: string; imageUrl: string | null; isLoading: boolean }>({
    attachmentKey: "",
    error: "",
    imageUrl: null,
    isLoading: false,
  });

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

    if (!isSafeSupportTicketImage(attachment)) {
      return undefined;
    }

    void fetchSupportTicketAttachmentBlob(attachment)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ attachmentKey, error: "", imageUrl: objectUrl, isLoading: false });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setState({ attachmentKey, error: error instanceof Error ? error.message : "Image could not be loaded", imageUrl: null, isLoading: false });
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, attachmentKey]);

  if (!isSafeSupportTicketImage(attachment)) {
    return { error: "Unsupported image type", imageUrl: null, isLoading: false };
  }

  if (state.attachmentKey !== attachmentKey) {
    return { error: "", imageUrl: null, isLoading: true };
  }

  return state;
}

function getAttachmentPreviewKey(attachment: SupportTicketAttachment) {
  return [attachment.id ?? "", attachment.url ?? "", attachment.fileName, attachment.mediaType, attachment.sizeBytes, attachment.dataUrl?.length ?? 0].join(":");
}

function ConversationItem({ authorName, authorRole, createdAt, message }: { authorName: string; authorRole: string; createdAt: string; message: string }) {
  const isRequester = authorRole === "enterprise" || authorRole === "requester";
  return (
    <article className={`rounded-2xl border p-3 ${isRequester ? "border-emerald-100 bg-emerald-50/70 dark:border-emerald-300/20 dark:bg-emerald-500/10" : "border-blue-100 bg-blue-50/70 dark:border-blue-300/20 dark:bg-blue-500/10"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-950">{authorName}</p>
        <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
          {authorRoleLabel(authorRole)} / {formatTicketTime(createdAt)}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{message}</p>
    </article>
  );
}

function TicketStatusBadge({ status }: { status: SupportTicketStatus }) {
  const classes: Record<SupportTicketStatus, string> = {
    Open: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-300/30 dark:bg-blue-500/15 dark:text-blue-200",
    "In Review": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/30 dark:bg-amber-400/15 dark:text-amber-200",
    Resolved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  };
  return <span className={`rounded-full border px-3 py-1 text-[10px] font-black tracking-wide whitespace-nowrap uppercase ${classes[status]}`}>{status}</span>;
}

function PriorityBadge({ priority }: { priority: SupportTicketPriority }) {
  const classes: Record<SupportTicketPriority, string> = {
    Urgent: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    High: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    Normal: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600",
    Low: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-black tracking-wide whitespace-nowrap uppercase ring-1 ${classes[priority]}`}>{priority}</span>;
}

function CategoryBadge({ category }: { category: SupportTicketCategory }) {
  return <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide whitespace-nowrap text-emerald-700 uppercase ring-1 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20">{category}</span>;
}

function authorRoleLabel(role: string) {
  if (role === "it") return "IT Personnel";
  if (role === "admin") return "Admin";
  if (role === "staff") return "Staff";
  if (role === "enterprise") return "Enterprise";
  if (role === "requester") return "Requester";
  return role;
}

function formatTicketTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
