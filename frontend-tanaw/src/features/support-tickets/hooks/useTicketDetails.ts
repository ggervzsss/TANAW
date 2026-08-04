import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getSupportTicket, replyToSupportTicket, supportTicketsQueryKey, updateSupportTicketStatus, type SupportTicketStatus } from "@/shared/services/supportTickets";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";

export function useTicketDetails(ticketId: string) {
  const queryClient = useQueryClient();
  const [reply, setReplyValue] = useState("");
  const [replyError, setReplyError] = useState("");
  const queryKey = [...supportTicketsQueryKey, ticketId];
  const detailQuery = useQuery({
    queryKey,
    queryFn: () => getSupportTicket(ticketId),
  });

  const replyMutation = useMutation({
    mutationFn: (message: string) => replyToSupportTicket(ticketId, message),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKey, detail);
      void queryClient.invalidateQueries({ queryKey: supportTicketsQueryKey });
      setReplyValue("");
      setReplyError("");
    },
    onError: (error) => setReplyError(getApiErrorMessage(error, "Unable to send reply. Please try again.")),
  });

  const statusMutation = useMutation({
    mutationFn: (status: SupportTicketStatus) => updateSupportTicketStatus(ticketId, status),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKey, detail);
      void queryClient.invalidateQueries({ queryKey: supportTicketsQueryKey });
    },
  });

  const setReply = (value: string) => {
    setReplyValue(value);
    setReplyError("");
  };

  const submitReply = () => {
    const trimmed = reply.trim();
    if (!trimmed) {
      setReplyError("Enter a response before sending.");
      return;
    }
    replyMutation.mutate(trimmed);
  };

  return {
    detailQuery,
    reply,
    replyError,
    isReplyPending: replyMutation.isPending,
    isStatusPending: statusMutation.isPending,
    setReply,
    submitReply,
    updateStatus: statusMutation.mutate,
  };
}
