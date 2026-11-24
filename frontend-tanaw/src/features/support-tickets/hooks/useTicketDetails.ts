import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getRequest,
  markRequestUrgent,
  moveRequest,
  reopenRequest,
  replyToRequest,
  requestDetailQueryKey,
  requestsQueryKey,
  updateRequestStatus,
  type RequestDetail,
  type RequestGroup,
  type RequestStatus,
} from "@/shared/services/requests";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";

/** One request for IT: reply, change the status, reopen, move it to another group, flag it urgent. */
export function useTicketDetails(requestId: string) {
  const queryClient = useQueryClient();
  const [reply, setReplyValue] = useState("");
  const [replyError, setReplyError] = useState("");
  const [actionError, setActionError] = useState("");
  const queryKey = requestDetailQueryKey(requestId);
  const detailQuery = useQuery({ queryKey, queryFn: () => getRequest(requestId) });

  const saved = (detail: RequestDetail) => {
    queryClient.setQueryData(queryKey, detail);
    void queryClient.invalidateQueries({ queryKey: requestsQueryKey });
    setActionError("");
  };
  const failed = (error: unknown) => setActionError(getApiErrorMessage(error, "That change could not be saved. Try again."));

  const replyMutation = useMutation({
    mutationFn: (message: string) => replyToRequest(requestId, message),
    onSuccess: (detail) => {
      saved(detail);
      setReplyValue("");
      setReplyError("");
    },
    onError: (error) => setReplyError(getApiErrorMessage(error, "Unable to send reply. Please try again.")),
  });
  const statusMutation = useMutation({ mutationFn: (status: RequestStatus) => updateRequestStatus(requestId, status), onSuccess: saved, onError: failed });
  const reopenMutation = useMutation({ mutationFn: () => reopenRequest(requestId), onSuccess: saved, onError: failed });
  const groupMutation = useMutation({ mutationFn: (group: RequestGroup) => moveRequest(requestId, group), onSuccess: saved, onError: failed });
  const urgentMutation = useMutation({ mutationFn: (urgent: boolean) => markRequestUrgent(requestId, urgent), onSuccess: saved, onError: failed });

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
    actionError,
    isReplyPending: replyMutation.isPending,
    isStatusPending: statusMutation.isPending || reopenMutation.isPending || groupMutation.isPending || urgentMutation.isPending,
    setReply,
    submitReply,
    updateStatus: statusMutation.mutate,
    reopen: () => reopenMutation.mutate(),
    moveToGroup: groupMutation.mutate,
    setUrgent: urgentMutation.mutate,
  };
}
