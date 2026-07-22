import { Check, Clock, Mail, Phone, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import {
  type AccountProfileChangeRequest,
  type AccountSummary,
  resolveAccountEmailChangeRequest,
  resolveEnterpriseProfileChangeRequest,
} from "@/shared/services/accountManagement";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

type EnterpriseProfileRequestsPanelProps = {
  accounts: AccountSummary[];
  canResolve: boolean;
  onAccountUpdated: (account: AccountSummary) => void;
  highlightedAccountId?: string | null;
};

type RequestRow = {
  enterprise: AccountSummary;
  request: AccountProfileChangeRequest;
};

type ResolutionPayload = RequestRow & {
  action: "approve" | "decline";
};

export function EnterpriseProfileRequestsPanel({ accounts, canResolve, onAccountUpdated, highlightedAccountId = null }: EnterpriseProfileRequestsPanelProps) {
  const queryClient = useQueryClient();
  const { timeFormat } = useSystemDisplayPreferences();
  const requests = accounts
    .flatMap((enterprise) => enterprise.profileChangeRequests.map((request) => ({ enterprise, request })))
    .sort((left, right) => Number(right.enterprise.id === highlightedAccountId) - Number(left.enterprise.id === highlightedAccountId));

  const resolutionMutation = useMutation({
    mutationFn: ({ enterprise, request, action }: ResolutionPayload) =>
      request.type === "businessEmail"
        ? resolveAccountEmailChangeRequest(enterprise.id, action)
        : resolveEnterpriseProfileChangeRequest(enterprise.id, request.type, action),
    onSuccess: async (updatedEnterprise, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] });
      onAccountUpdated(updatedEnterprise);
      toast.success(`${variables.request.label} request ${variables.action === "approve" ? "approved" : "declined"}.`);
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] });
      toast.error(getApiErrorMessage(error, "Unable to resolve profile change request."));
    },
  });

  if (requests.length === 0) {
    return null;
  }

  return (
    <section className="tanaw-request-queue mt-4 rounded-2xl border p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-black text-(--tanaw-text)">
            <Clock size={16} className="shrink-0 text-amber-600 dark:text-amber-300" /> Enterprise Account Requests
          </p>
          <p className="mt-0.5 text-xs font-medium text-(--tanaw-secondary-text)">
            {canResolve ? "Review requests. Email changes can be approved only after ownership verification." : "Visible for admin review. IT personnel apply or decline these requests."}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-800 uppercase dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-200">
          {requests.length} pending
        </span>
      </div>

      <div className="space-y-2">
        {requests.map(({ enterprise, request }) => (
          <article
            key={`${enterprise.id}-${request.requestId ?? request.type}`}
            className={`grid items-center gap-3 rounded-xl border bg-(--tanaw-surface-raised) p-3 ${canResolve && request.status !== "expired" ? "md:grid-cols-[minmax(0,1.1fr)_minmax(18rem,1fr)_auto]" : "md:grid-cols-[minmax(0,1.1fr)_minmax(18rem,1fr)]"} ${
              enterprise.id === highlightedAccountId ? "border-emerald-500 ring-2 ring-emerald-100 dark:ring-emerald-400/15" : "border-(--tanaw-border-subtle)"
            }`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-400/12 dark:text-amber-200">
                {request.type === "businessEmail" ? <Mail size={17} /> : <Phone size={17} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-(--tanaw-text)">{enterprise.enterpriseName ?? enterprise.displayName}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-(--tanaw-secondary-text)">{request.label} change requested</p>
                  <RequestStatusBadge request={request} />
                </div>
                {request.requestedAt && <p className="mt-1 text-[10px] font-semibold text-(--tanaw-muted-text)">Requested {formatPhilippineDateTime(request.requestedAt, timeFormat)}</p>}
              </div>
            </div>

            <div className="grid min-w-0 gap-2 text-xs sm:grid-cols-2">
              <ValueBlock label="Current" value={getCurrentValue(enterprise, request)} />
              <ValueBlock label="Requested" value={request.requestedValue} highlight />
            </div>

            {canResolve && request.status !== "expired" && (
              <div className="flex flex-wrap justify-end gap-2 md:flex-col">
                <button
                  type="button"
                  disabled={resolutionMutation.isPending}
                  onClick={() => resolutionMutation.mutate({ enterprise, request, action: "decline" })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-(--tanaw-border-subtle) bg-transparent px-3 py-1.5 text-xs font-bold text-(--tanaw-secondary-text) transition-colors hover:bg-(--tanaw-control-hover) disabled:opacity-60"
                >
                  <X size={14} /> Decline
                </button>
                <button
                  type="button"
                  disabled={resolutionMutation.isPending || !request.canApprove}
                  title={!request.canApprove ? "The proposed email owner must use the verification link first." : undefined}
                  onClick={() => resolutionMutation.mutate({ enterprise, request, action: "approve" })}
                  className="bg-tanaw-green inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#044a1e] disabled:opacity-60"
                >
                  <Check size={14} /> Approve
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ValueBlock({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-400/8 dark:text-emerald-200" : "border-(--tanaw-border-subtle) bg-(--tanaw-surface-inset) text-(--tanaw-secondary-text)"}`}>
      <p className="text-[10px] font-black tracking-wide uppercase">{label}</p>
      <p className="mt-1 font-mono text-xs font-bold wrap-break-word">{value || "Not provided"}</p>
    </div>
  );
}

function RequestStatusBadge({ request }: { request: AccountProfileChangeRequest }) {
  const labels = {
    pending_verification: "Awaiting email verification",
    verified: "Ownership verified",
    pending_review: "Awaiting IT review",
    expired: "Expired",
  } as const;
  const verified = request.status === "verified";
  const expired = request.status === "expired";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${verified ? "bg-emerald-100 text-emerald-700" : expired ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
      {labels[request.status]}
    </span>
  );
}

function getCurrentValue(enterprise: AccountSummary, request: AccountProfileChangeRequest) {
  return request.type === "businessEmail" ? enterprise.email : (enterprise.phone ?? "Not provided");
}
