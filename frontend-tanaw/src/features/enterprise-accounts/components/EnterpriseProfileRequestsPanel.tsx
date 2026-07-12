import { Check, Clock, Mail, Phone, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  type AccountProfileChangeRequest,
  type AccountSummary,
  resolveAccountEmailChangeRequest,
  resolveEnterpriseProfileChangeRequest,
} from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";

type EnterpriseProfileRequestsPanelProps = {
  accounts: AccountSummary[];
  canResolve: boolean;
  onAccountUpdated: (account: AccountSummary) => void;
};

type RequestRow = {
  enterprise: AccountSummary;
  request: AccountProfileChangeRequest;
};

type ResolutionPayload = RequestRow & {
  action: "approve" | "decline";
};

export function EnterpriseProfileRequestsPanel({ accounts, canResolve, onAccountUpdated }: EnterpriseProfileRequestsPanelProps) {
  const queryClient = useQueryClient();
  const requests = accounts.flatMap((enterprise) => enterprise.profileChangeRequests.map((request) => ({ enterprise, request })));

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
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-black text-amber-950">
            <Clock size={16} className="text-amber-700" /> Enterprise Profile Change Requests
          </p>
          <p className="mt-1 text-sm font-medium text-amber-800">
            {canResolve ? "Review requests. Email changes can be approved only after ownership verification." : "Visible for admin review. IT personnel apply or decline these requests."}
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-800 shadow-sm">{requests.length} pending</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {requests.map(({ enterprise, request }) => (
          <article key={`${enterprise.id}-${request.requestId ?? request.type}`} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                {request.type === "businessEmail" ? <Mail size={17} /> : <Phone size={17} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-950">{enterprise.enterpriseName ?? enterprise.displayName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-slate-500">{request.label} change requested</p>
                  <RequestStatusBadge request={request} />
                </div>
                <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                  <ValueBlock label="Current" value={getCurrentValue(enterprise, request)} />
                  <ValueBlock label="Requested" value={request.requestedValue} highlight />
                </div>
                {request.requestedAt && <p className="mt-2 text-[11px] font-semibold text-slate-500">Requested {new Date(request.requestedAt).toLocaleString()}</p>}
              </div>
            </div>

            {canResolve && request.status !== "expired" && (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={resolutionMutation.isPending}
                  onClick={() => resolutionMutation.mutate({ enterprise, request, action: "decline" })}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  <X size={14} /> Decline
                </button>
                <button
                  type="button"
                  disabled={resolutionMutation.isPending || !request.canApprove}
                  title={!request.canApprove ? "The proposed email owner must use the verification link first." : undefined}
                  onClick={() => resolutionMutation.mutate({ enterprise, request, action: "approve" })}
                  className="bg-tanaw-green inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white transition hover:bg-[#044a1e] disabled:opacity-60"
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
    <div className={`rounded-lg border px-3 py-2 ${highlight ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
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
