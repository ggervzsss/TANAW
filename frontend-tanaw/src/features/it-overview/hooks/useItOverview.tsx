import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries";
import { listRecentEmailDeliveries, retryEmailDelivery } from "@/features/email-deliveries/services/emailDeliveryService";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts";
import { lguAccountsQueryKey, listLguAccounts } from "@/features/lgu-accounts";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { resendAccountActivation } from "@/shared/services/accountService";
import { enterpriseHealthQueryKey, listEnterpriseHealth } from "@/shared/services/enterpriseHealth";
import { listRequests, requestDetailQueryKey, requestsQueryKey, startRequest, type Request } from "@/shared/services/requests";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import {
  accountRows,
  accountsFigure,
  camerasFigure,
  connectionRows,
  emailRows,
  greeting,
  markRequestStarted,
  placesFigure,
  requestRows,
  requestsFigure,
  statusLine,
  type AccountRow,
  type EmailRow,
  type OverviewAccount,
  type OverviewEmail,
  type RequestRow,
} from "../model/itOverview";

/** The Overview's email list: the last 7 days of the email log. Any `email-deliveries` refresh reaches it. */
export const OVERVIEW_EMAIL_DAYS = 7;
export const overviewEmailsQueryKey = [...emailDeliveriesQueryKey, "recent", OVERVIEW_EMAIL_DAYS] as const;

/** Enterprise health has no live event yet, so the Overview polls it while the tab is visible. */
const HEALTH_REFRESH_MS = 30_000;

const EMPTY: never[] = [];

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

function toastMessage(title: string, text: string) {
  return (
    <>
      <span className="block font-semibold">{title}</span>
      <span className="mt-0.5 block text-[0.8125rem] font-normal">{text}</span>
    </>
  );
}

function addTo(set: ReadonlySet<string>, id: string) {
  return new Set(set).add(id);
}

function removeFrom(set: ReadonlySet<string>, id: string) {
  const next = new Set(set);
  next.delete(id);
  return next;
}

export function useItOverview() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const now = useNow();
  const online = useOnline();
  const enabled = Boolean(token);

  const requestsQuery = useQuery({ queryKey: requestsQueryKey, queryFn: listRequests, enabled });
  const healthQuery = useQuery({ queryKey: enterpriseHealthQueryKey, queryFn: listEnterpriseHealth, enabled, refetchInterval: HEALTH_REFRESH_MS, refetchIntervalInBackground: false });
  const lguQuery = useQuery({ queryKey: lguAccountsQueryKey, queryFn: listLguAccounts, enabled });
  const enterpriseQuery = useQuery({ queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts, enabled });
  const emailsQuery = useQuery({ queryKey: overviewEmailsQueryKey, queryFn: () => listRecentEmailDeliveries(OVERVIEW_EMAIL_DAYS), enabled });

  const [startedIds, setStartedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [resentIds, setResentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [retriedIds, setRetriedIds] = useState<ReadonlySet<string>>(() => new Set());

  const viewer = useMemo(() => (user ? { id: user.id, displayName: user.displayName, firstName: user.firstName } : null), [user]);
  const formats = useMemo(() => ({ dateFormat, timeFormat }), [dateFormat, timeFormat]);
  const requests = requestsQuery.data ?? EMPTY;
  const health = healthQuery.data ?? EMPTY;
  const lguAccounts = (lguQuery.data ?? EMPTY) as OverviewAccount[];
  const enterpriseAccounts = (enterpriseQuery.data ?? EMPTY) as OverviewAccount[];
  const emails: readonly OverviewEmail[] = emailsQuery.data ?? EMPTY;

  const startMutation = useMutation({
    mutationFn: (request: RequestRow) => startRequest(request.id),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: requestsQueryKey, exact: true });
      const previous = queryClient.getQueryData<Request[]>(requestsQueryKey);
      if (viewer) queryClient.setQueryData<Request[]>(requestsQueryKey, (list) => markRequestStarted(list, request.id, viewer, new Date().toISOString()));
      setStartedIds((ids) => addTo(ids, request.id));
      return { previous };
    },
    onSuccess: (detail, request) => {
      queryClient.setQueryData(requestDetailQueryKey(request.id), detail);
      toast.success(toastMessage(`You are on ${request.code}`, "It is now In progress and the sender has been told."));
    },
    onError: (error, request, context) => {
      if (context?.previous) queryClient.setQueryData(requestsQueryKey, context.previous);
      setStartedIds((ids) => removeFrom(ids, request.id));
      toast.error(toastMessage(`Could not start on ${request.code}`, getApiErrorMessage(error, "Try again in a moment.")));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: requestsQueryKey }),
  });

  const resendMutation = useMutation({
    mutationFn: (row: AccountRow) => resendAccountActivation(row.accountId),
    onSuccess: (_account, row) => {
      setResentIds((ids) => addTo(ids, row.id));
      toast.success(toastMessage("Invitation sent again", `A new sign-in link went to ${row.name}.`));
      void queryClient.invalidateQueries({ queryKey: row.source === "enterprise" ? enterpriseAccountsQueryKey : lguAccountsQueryKey });
      if (row.source === "enterprise") void queryClient.invalidateQueries({ queryKey: enterpriseHealthQueryKey });
    },
    onError: (error, row) => toast.error(toastMessage("Invitation not sent", getApiErrorMessage(error, `TANAW could not send a new link to ${row.name}. Try again.`))),
  });

  const retryMutation = useMutation({
    mutationFn: (row: EmailRow) => retryEmailDelivery(row.id),
    onSuccess: (_delivery, row) => {
      setRetriedIds((ids) => addTo(ids, row.id));
      toast.success(toastMessage("Trying again", `TANAW is sending the email to ${row.to} again.`));
      void queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey });
    },
    onError: (error, row) => toast.error(toastMessage("Email not sent again", getApiErrorMessage(error, `TANAW could not send the email to ${row.to} again.`))),
  });

  const accounts = useMemo(() => accountRows(lguAccounts, enterpriseAccounts, now, formats), [lguAccounts, enterpriseAccounts, now, formats]);
  const queries = [requestsQuery, healthQuery, lguQuery, enterpriseQuery, emailsQuery];
  const lastUpdatedAt = Math.max(0, ...queries.map((query) => query.dataUpdatedAt));

  return {
    greeting: greeting(now, viewer),
    status: statusLine({ isLoading: queries.some((query) => query.isLoading), hasError: queries.some((query) => query.isError), online, lastUpdatedAt, now }),
    figures: {
      requests: requestsFigure(requests, viewer),
      places: placesFigure(health),
      cameras: camerasFigure(health),
      accounts: accountsFigure(accounts),
    },
    requests: {
      rows: requestRows(requests, viewer, startedIds, now, formats),
      isLoading: requestsQuery.isLoading,
      isError: requestsQuery.isError && !requestsQuery.data,
      refetch: () => void requestsQuery.refetch(),
      start: (row: RequestRow) => startMutation.mutate(row),
      startingId: startMutation.isPending ? startMutation.variables.id : null,
    },
    connections: {
      rows: connectionRows(health, requests, now, formats),
      isLoading: healthQuery.isLoading,
      isError: healthQuery.isError && !healthQuery.data,
      refetch: () => void healthQuery.refetch(),
    },
    accounts: {
      rows: accounts,
      isLoading: lguQuery.isLoading || enterpriseQuery.isLoading,
      isError: (lguQuery.isError && !lguQuery.data) || (enterpriseQuery.isError && !enterpriseQuery.data),
      refetch: () => {
        void lguQuery.refetch();
        void enterpriseQuery.refetch();
      },
      resentIds,
      resend: (row: AccountRow) => resendMutation.mutate(row),
      resendingId: resendMutation.isPending ? resendMutation.variables.id : null,
    },
    emails: {
      rows: emailRows(emails, retriedIds, now, formats),
      isLoading: emailsQuery.isLoading,
      isError: emailsQuery.isError && !emailsQuery.data,
      refetch: () => void emailsQuery.refetch(),
      retry: (row: EmailRow) => retryMutation.mutate(row),
      retryingId: retryMutation.isPending ? retryMutation.variables.id : null,
    },
  };
}

export type ItOverview = ReturnType<typeof useItOverview>;
