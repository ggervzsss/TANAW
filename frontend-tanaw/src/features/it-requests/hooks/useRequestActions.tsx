import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import { enterpriseHealthDetailQueryKey, getEnterpriseHealth } from "@/shared/services/enterpriseHealth";
import {
  moveRequest,
  reopenRequest,
  replyToRequest,
  requestDetailQueryKey,
  requestsQueryKey,
  startRequest,
  updateRequestStatus,
  type Request,
  type RequestDetail,
  type RequestGroup,
} from "@/shared/services/requests";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { senderName } from "../model";

export type RequestAction =
  | { kind: "start" }
  | { kind: "resolve" }
  | { kind: "approve" }
  | { kind: "decline"; reason: string }
  | { kind: "reopen" }
  | { kind: "move"; group: RequestGroup }
  | { kind: "reply"; message: string; resolve: boolean };

async function runAction(requestId: string, action: RequestAction): Promise<RequestDetail> {
  switch (action.kind) {
    case "start":
      return startRequest(requestId);
    case "resolve":
      return updateRequestStatus(requestId, "Resolved");
    case "approve":
      return updateRequestStatus(requestId, "Approved");
    case "decline":
      // The reason goes to the sender first, so it shows before "Declined" in the conversation.
      if (action.reason) await replyToRequest(requestId, action.reason);
      return updateRequestStatus(requestId, "Resolved");
    case "reopen":
      return reopenRequest(requestId);
    case "move":
      return moveRequest(requestId, action.group);
    case "reply": {
      const detail = await replyToRequest(requestId, action.message);
      return action.resolve ? updateRequestStatus(requestId, "Resolved") : detail;
    }
  }
}

function successToast(request: Request, action: RequestAction): [string, string] {
  const sender = senderName(request);
  const change = request.accountChange;
  switch (action.kind) {
    case "start":
      return [`You are on ${request.code}`, `${sender} can see that IT is working on it.`];
    case "resolve":
      return ["Marked resolved", `${request.code} is resolved. The sender can reopen it.`];
    case "approve":
      return ["Change approved", change ? `${change.label} is now “${change.requestedValue}”.` : `${request.code} is approved.`];
    case "decline":
      return ["Change declined", `The old ${change ? change.label.toLowerCase() : "value"} stays. ${sender} was told.`];
    case "reopen":
      return ["Reopened", `${request.code} is back in progress, with you.`];
    case "move":
      return [`Moved to ${action.group}`, `${request.code} now shows under ${action.group}.`];
    case "reply": {
      const where = request.enterpriseName ? ` at ${request.enterpriseName}` : "";
      return [action.resolve ? "Reply sent and resolved" : "Reply sent", `Sent to ${sender}${where}.`];
    }
  }
}

const failureTitles: Record<RequestAction["kind"], string> = {
  start: "Could not start on it",
  resolve: "Not marked resolved",
  approve: "Change not approved",
  decline: "Change not declined",
  reopen: "Not reopened",
  move: "Not moved",
  reply: "Reply not sent",
};

function toastBody(title: string, text: string) {
  return (
    <>
      <span className="block font-semibold">{title}</span>
      <span className="mt-0.5 block text-[0.8125rem] font-normal">{text}</span>
    </>
  );
}

function withoutMessages(detail: RequestDetail): Request {
  const summary: Partial<RequestDetail> = { ...detail };
  delete summary.messages;
  return summary as Request;
}

/** The mutation behind every action: it updates the request in place and shows a toast. */
function useActionMutation(onDone?: (action: RequestAction) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, target }: { action: RequestAction; target: Request }) => runAction(target.id, action),
    onSuccess: (detail, { action, target }) => {
      queryClient.setQueryData(requestDetailQueryKey(target.id), detail);
      const summary = withoutMessages(detail);
      queryClient.setQueryData<Request[]>(requestsQueryKey, (current) => current?.map((item) => (item.id === target.id ? { ...item, ...summary } : item)));
      void queryClient.invalidateQueries({ queryKey: requestsQueryKey });
      void queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
      const [title, text] = successToast(target, action);
      toast.success(toastBody(title, text));
      onDone?.(action);
    },
    onError: (failure, { action, target }) => {
      // A request someone else changed meanwhile: show its current state.
      void queryClient.invalidateQueries({ queryKey: requestDetailQueryKey(target.id) });
      void queryClient.invalidateQueries({ queryKey: requestsQueryKey });
      toast.error(toastBody(failureTitles[action.kind], getApiErrorMessage(failure, "That change could not be saved. Try again.")));
    },
  });
}

/** IT's actions on one request. Each updates the request in place and shows a toast. */
export function useRequestActions(request: Request | null, options: { onDone?: (action: RequestAction) => void } = {}) {
  const mutation = useActionMutation(options.onDone);
  return {
    run: (action: RequestAction) => {
      if (!request || mutation.isPending) return;
      mutation.mutate({ action, target: request });
    },
    pending: mutation.isPending ? (mutation.variables?.action.kind ?? null) : null,
  };
}

export type RequestActionsApi = ReturnType<typeof useRequestActions>;

/** Start on it from a request's row in the table: one request at a time. */
export function useStartRequest() {
  const mutation = useActionMutation();
  return {
    start: (request: Request) => {
      if (mutation.isPending) return;
      mutation.mutate({ action: { kind: "start" }, target: request });
    },
    startingId: mutation.isPending ? (mutation.variables?.target.id ?? null) : null,
  };
}

/** The place's desktop app status, for the Details grid. */
export function useEnterpriseAppHealth(enterpriseId: string | null | undefined) {
  return useQuery({
    queryKey: enterpriseHealthDetailQueryKey(enterpriseId ?? ""),
    queryFn: () => getEnterpriseHealth(enterpriseId ?? ""),
    enabled: Boolean(enterpriseId),
    retry: 1,
    staleTime: 30_000,
  });
}
