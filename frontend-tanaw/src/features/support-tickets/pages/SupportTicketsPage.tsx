import { Alert, Button } from "@/shared/ui-kit";
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
import { isClosedRequest, listRequests, requestsQueryKey, type Request } from "@/shared/services/requests";
import { SupportTicketFilters, SupportTicketsTable, TicketDetailsModal } from "../components";
import { filterSupportTickets, initialTicketFilters, isTicketFilterState } from "../model";

type SupportTicketsPageProps = {
  mode: "admin" | "it";
  embedded?: boolean;
  inSettings?: boolean;
};

const EMPTY_SUPPORT_TICKETS: Request[] = [];

export function SupportTicketsPage({ mode, embedded = false, inSettings = false }: SupportTicketsPageProps) {
  const { timeFormat } = useSystemDisplayPreferences();
  const [filters, setFilters] = useScopedPageState({
    initialValue: initialTicketFilters,
    isValid: isTicketFilterState,
    namespace: `${mode}-ticket-filters`,
    version: 3,
  });
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const ticketsQuery = useQuery({ queryKey: requestsQueryKey, queryFn: listRequests });
  const tickets = ticketsQuery.data ?? EMPTY_SUPPORT_TICKETS;
  const filteredTickets = useMemo(() => filterSupportTickets(tickets, filters), [filters, tickets]);
  const isItResponder = mode === "it";
  const routeTicketId = searchParams.get("request");
  const activeTicketId = routeTicketId ?? selectedTicketId;

  const clearRouteTicket = () => {
    if (!routeTicketId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("request");
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
    <PageMotion className={inSettings ? "tanaw-data-page space-y-3" : "tanaw-data-page pb-12"}>
      {!embedded && (
        <PageHeader
          title="Requests"
          description={isItResponder ? "Help people with problems, and approve account changes or resolve them without approving." : "Requests people sent to IT. IT handles them."}
        />
      )}

      {inSettings && ticketsQuery.isError && (
        <Alert
          tone="danger"
          title="Unable to load requests"
          action={
            <Button variant="secondary" size="sm" onClick={() => void ticketsQuery.refetch()}>
              Retry
            </Button>
          }
        />
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

function SupportTicketMetrics({ isLoading, tickets }: { isLoading: boolean; tickets: Request[] }) {
  const open = tickets.filter((ticket) => !isClosedRequest(ticket));
  const help = open.filter((ticket) => ticket.group !== "Account change");
  const changes = open.filter((ticket) => ticket.group === "Account change");
  const resolved = tickets.filter((ticket) => ticket.status === "Resolved");

  return (
    <UnifiedMetricsHeader
      ariaLabel="Request summary"
      metrics={[
        { id: "open", title: "Open Requests", value: open.length, description: "In progress", tone: "info", icon: Clock3, isLoading },
        { id: "help", title: "Help Requests", value: help.length, description: "Problems IT is working on", tone: "warning", icon: AlertCircle, isLoading },
        { id: "changes", title: "Account Changes", value: changes.length, description: "Waiting for approval", tone: "teal", icon: ImageIcon, isLoading },
        { id: "resolved", title: "Resolved", value: resolved.length, description: "Closed by IT", tone: "success", icon: TicketCheck, isLoading },
      ]}
    />
  );
}
