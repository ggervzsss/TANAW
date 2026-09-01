import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock3, ImageIcon, TicketCheck } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { useScopedPageState } from "@/app/hooks/useScopedPageState";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { listSupportTickets, supportTicketsQueryKey, type SupportTicket } from "@/shared/services/supportTickets";
import { SupportTicketFilters, SupportTicketsTable, TicketDetailsModal } from "../components";
import { filterSupportTickets, initialTicketFilters, isTicketFilterState } from "../model";

type SupportTicketsPageProps = {
  mode: "admin" | "it";
  embedded?: boolean;
};

const EMPTY_SUPPORT_TICKETS: SupportTicket[] = [];

export function SupportTicketsPage({ mode, embedded = false }: SupportTicketsPageProps) {
  const { timeFormat } = useSystemDisplayPreferences();
  const [filters, setFilters] = useScopedPageState({
    initialValue: initialTicketFilters,
    isValid: isTicketFilterState,
    namespace: `${mode}-ticket-filters`,
    version: 1,
  });
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const ticketsQuery = useQuery({ queryKey: supportTicketsQueryKey, queryFn: listSupportTickets });
  const tickets = ticketsQuery.data ?? EMPTY_SUPPORT_TICKETS;
  const filteredTickets = useMemo(() => filterSupportTickets(tickets, filters), [filters, tickets]);
  const isItResponder = mode === "it";
  const routeTicketId = searchParams.get("ticket");
  const activeTicketId = routeTicketId ?? selectedTicketId;

  const clearRouteTicket = () => {
    if (!routeTicketId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("ticket");
    setSearchParams(nextParams, { replace: true });
  };

  const openTicketDetails = (ticketId: string) => {
    setSelectedTicketId(ticketId);
    clearRouteTicket();
  };

  const closeTicketDetails = () => {
    setSelectedTicketId(null);
    clearRouteTicket();
  };

  return (
    <PageMotion className="tanaw-data-page pb-12">
      {!embedded && (
        <PageHeader
          title="Support Requests"
          description={isItResponder ? "Help enterprises with questions and technical problems." : "Read-only supervision for enterprise requests, IT responses, and request status."}
        />
      )}

      {!isItResponder && (
        <div className="mb-5 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 dark:border-indigo-300/25 dark:bg-indigo-500/10 dark:text-indigo-200">
          IT personnel handle user responses. Admin can monitor ticket status, attachments, and communication.
        </div>
      )}

      <SupportTicketMetrics isLoading={ticketsQuery.isLoading} tickets={tickets} />
      <SupportTicketsTable
        isItResponder={isItResponder}
        isLoading={ticketsQuery.isLoading}
        onOpenTicket={openTicketDetails}
        tickets={filteredTickets}
        timeFormat={timeFormat}
        toolbar={<SupportTicketFilters filters={filters} onChange={setFilters} />}
      />

      <AnimatePresence>{activeTicketId && <TicketDetailsModal mode={mode} ticketId={activeTicketId} timeFormat={timeFormat} onClose={closeTicketDetails} />}</AnimatePresence>
    </PageMotion>
  );
}

function SupportTicketMetrics({ isLoading, tickets }: { isLoading: boolean; tickets: SupportTicket[] }) {
  const activeTickets = tickets.filter((ticket) => ticket.status !== "Resolved");
  const urgentTickets = tickets.filter((ticket) => ticket.priority === "Urgent" || ticket.priority === "High");
  const inReviewTickets = tickets.filter((ticket) => ticket.status === "In Review");
  const ticketsWithAttachments = tickets.filter((ticket) => ticket.attachments.length > 0);

  return (
    <UnifiedMetricsHeader
      ariaLabel="Support request summary"
      metrics={[
        { id: "open", title: "Open Requests", value: activeTickets.length, description: "New or being handled", tone: "success", icon: TicketCheck, isLoading },
        { id: "priority", title: "High Priority", value: urgentTickets.length, description: "High or urgent queue", tone: "warning", icon: AlertCircle, isLoading },
        { id: "working", title: "Working on It", value: inReviewTickets.length, description: "Currently handled by IT", tone: "info", icon: Clock3, isLoading },
        { id: "photos", title: "With Photos", value: ticketsWithAttachments.length, description: "Attachment-backed tickets", tone: "teal", icon: ImageIcon, isLoading },
      ]}
    />
  );
}
