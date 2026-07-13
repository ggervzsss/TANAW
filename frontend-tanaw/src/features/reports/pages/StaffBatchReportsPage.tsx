import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useEnterpriseReports, usePeriodCompliance, useReportingPeriods } from "@/shared/hooks/useReportWorkflow";
import { createReminderIntents, finalizeReports, reportWorkflowQueryKey, runReportingPeriodLifecycle } from "@/shared/services/reporting";
import type { FinalReportScopeType, FinalizeReportsCommand } from "@/shared/types";
import { BatchReportsMetrics, BatchReportsStatusNotice, BatchReportsTable, BatchReportsToolbar, ReportActionConfirmDialog, ReportReviewModal } from "../components";
import { acceptedRevisionIds, buildComplianceRows, reportMatchesScope } from "../utils/reportWorkflow";

export function StaffBatchReportsPage() {
  const queryClient = useQueryClient();
  const periodsQuery = useReportingPeriods();
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const [requestedPeriodId, setRequestedPeriodId] = useState("");
  const selectedPeriodId = periods.some((period) => period.reportingPeriodId === requestedPeriodId) ? requestedPeriodId : (periods[0]?.reportingPeriodId ?? "");
  const selectedPeriod = periods.find((period) => period.reportingPeriodId === selectedPeriodId) ?? null;
  const reportsQuery = useEnterpriseReports({ reportingPeriodId: selectedPeriodId || undefined }, Boolean(selectedPeriodId));
  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);
  const complianceQuery = usePeriodCompliance(selectedPeriodId || null);
  const compliance = complianceQuery.data ?? null;
  const [query, setQuery] = useState("");
  const [scopeType, setScopeType] = useState<FinalReportScopeType>("citywide");
  const [barangay, setBarangay] = useState("");
  const [manualSelectedReportIds, setManualSelectedReportIds] = useState<Set<string>>(() => new Set());
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [isFinalizeConfirmOpen, setIsFinalizeConfirmOpen] = useState(false);

  const periodReports = useMemo(() => reports.filter((report) => report.reportingPeriod.reportingPeriodId === selectedPeriodId), [reports, selectedPeriodId]);
  const rows = useMemo(() => (compliance ? buildComplianceRows(compliance, periodReports) : []), [compliance, periodReports]);
  const availableBarangays = useMemo(
    () => Array.from(new Set(rows.map((row) => row.obligation.frozenBarangay).filter((value): value is string => Boolean(value)))).sort((left, right) => left.localeCompare(right)),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [row.enterpriseLabel, row.siteLabel, row.obligation.enterpriseId, row.obligation.siteId, row.obligation.frozenBarangay ?? "", row.obligation.obligationId].some((value) => value.toLowerCase().includes(needle)));
  }, [query, rows]);

  const acceptedReports = useMemo(() => periodReports.filter((report) => report.workflowState === "accepted" && report.acceptedRevisionId !== null), [periodReports]);
  const selectedReports = useMemo(() => {
    const selectedIds = manualSelectedReportIds;
    return acceptedReports.filter((report) => reportMatchesScope(report, { type: scopeType, barangay: scopeType === "barangay" ? barangay || null : null }, selectedIds));
  }, [acceptedReports, barangay, manualSelectedReportIds, scopeType]);
  const selectedReportIds = useMemo(() => new Set(selectedReports.map((report) => report.enterpriseReportId)), [selectedReports]);
  const targetedScopeObligations = rows.filter((row) => scopeType !== "barangay" || row.obligation.frozenBarangay === barangay);
  const targetedEligibleObligations = targetedScopeObligations.filter((row) => row.obligation.eligibilityStatus === "eligible");
  const completeScope =
    scopeType === "enterprise_selection" ||
    (targetedEligibleObligations.length > 0 &&
      !targetedScopeObligations.some((row) => row.obligation.eligibilityStatus === "unknown") &&
      targetedEligibleObligations.every((row) => row.obligation.complianceStatus === "accepted"));
  const canFinalize = Boolean(selectedPeriod && selectedReports.length > 0 && completeScope && !reportsQuery.isLoading && !complianceQuery.isLoading);
  const isComplianceMissing = isNotFound(complianceQuery.error);

  const lifecycleMutation = useMutation({
    mutationFn: runReportingPeriodLifecycle,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: reportWorkflowQueryKey });
      toast.success(`Server lifecycle evaluated ${result.ensuredPeriodCount} periods: ${result.createdCount} created, ${result.transitionedCount} transitioned, ${result.frozenCount} frozen.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The server reporting-period lifecycle could not be reconciled.")),
  });

  const reminderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPeriod) throw new Error("Select a server-returned reporting period first.");
      return createReminderIntents(selectedPeriod.reportingPeriodId, crypto.randomUUID());
    },
    onSuccess: (acknowledgement) => toast.success(`${acknowledgement.createdCount} reminder intent${acknowledgement.createdCount === 1 ? "" : "s"} created; ${acknowledgement.existingCount} already existed.`),
    onError: (error) => toast.error(apiErrorMessage(error, "Reminder intents could not be created.")),
  });

  const finalizationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPeriod || !canFinalize) throw new Error("The selected scope is not ready for exact finalization.");
      const commandId = crypto.randomUUID();
      const revisionIds = acceptedRevisionIds(selectedReports);
      const command: FinalizeReportsCommand = {
        contractVersion: 2,
        commandId,
        idempotencyKey: `final-report:${safeIdempotencySegment(selectedPeriod.naturalKey)}:${commandId}`,
        occurredAt: new Date().toISOString(),
        expectedVersion: 0,
        payload: {
          targetFinalizationId: null,
          reportingPeriodId: selectedPeriod.reportingPeriodId,
          scope: { type: scopeType, barangay: scopeType === "barangay" ? barangay : null },
          reportRevisionIds: revisionIds,
          reason: null,
        },
      };
      return finalizeReports(command);
    },
    onSuccess: async (acknowledgement) => {
      await queryClient.invalidateQueries({ queryKey: reportWorkflowQueryKey });
      setIsFinalizeConfirmOpen(false);
      setManualSelectedReportIds(new Set());
      toast.success(`${acknowledgement.resource.reportCode} finalized as immutable version ${acknowledgement.resource.versionNumber}.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The exact report scope could not be finalized.")),
  });

  const changeScope = (next: FinalReportScopeType) => {
    setScopeType(next);
    setManualSelectedReportIds(new Set());
    if (next !== "barangay") setBarangay("");
  };

  const toggleReport = (reportId: string) => {
    if (scopeType !== "enterprise_selection") return;
    setManualSelectedReportIds((current) => {
      const next = new Set(current);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  };

  const loadError = reportsQuery.isError || periodsQuery.isError;

  return (
    <PageMotion>
      <PageHeader title="Batch Reports" description="Review official evidence, period obligations, and exact accepted revisions before immutable finalization." />

      {loadError && <Notice tone="error">Official v2 report resources could not be loaded. TANAW will not use legacy lists as a fallback.</Notice>}
      {periods.length === 0 && !periodsQuery.isLoading && (
        <Notice tone="warning">No official reporting period was returned by the Staff discovery endpoint. TANAW will not invent one from the browser clock. Run the server lifecycle to ensure its configured period horizon.</Notice>
      )}
      {selectedPeriod && isComplianceMissing && (
        <Notice tone="warning">This official period does not yet have a readable frozen compliance snapshot. Missing submissions are blocked rather than inferred from report absence. The server lifecycle determines when the obligation snapshot is due.</Notice>
      )}
      {selectedPeriod && complianceQuery.isError && !isComplianceMissing && <Notice tone="error">The authoritative compliance snapshot could not be read. Missing counts and finalization completeness are blocked.</Notice>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <div><strong>Server-owned period lifecycle</strong><p className="mt-0.5 text-xs text-slate-500">The backend evaluates its own clock, creates the configured horizon, advances status, and freezes due obligations. The browser sends no date, label, or period ID.</p></div>
        <button type="button" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate()} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">{lifecycleMutation.isPending ? "Running server lifecycle…" : "Run server period lifecycle"}</button>
      </div>

      <BatchReportsMetrics compliance={compliance} loadedReportCount={periodReports.length} />

      <Panel className="mt-6 overflow-hidden">
        <BatchReportsToolbar
          query={query}
          periods={periods}
          selectedPeriodId={selectedPeriodId}
          scopeType={scopeType}
          barangay={barangay}
          availableBarangays={availableBarangays}
          selectedCount={selectedReports.length}
          canFinalize={canFinalize && !finalizationMutation.isPending}
          onQueryChange={setQuery}
          onPeriodChange={(value) => { setRequestedPeriodId(value); setManualSelectedReportIds(new Set()); setBarangay(""); }}
          onScopeChange={changeScope}
          onBarangayChange={(value) => { setBarangay(value); setManualSelectedReportIds(new Set()); }}
          onGenerate={() => setIsFinalizeConfirmOpen(true)}
        />
        <BatchReportsStatusNotice compliance={compliance} />
        {compliance && compliance.summary.notSubmitted > 0 && (
          <div className="flex justify-end border-b border-slate-200 bg-white px-5 py-3"><button type="button" disabled={reminderMutation.isPending} onClick={() => reminderMutation.mutate()} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 disabled:opacity-50">{reminderMutation.isPending ? "Creating reminder intents…" : "Create idempotent reminder intents"}</button></div>
        )}
        <BatchReportsTable rows={filteredRows} isLoading={complianceQuery.isLoading} selectedReportIds={selectedReportIds} selectionLocked={scopeType !== "enterprise_selection"} onToggleReport={toggleReport} onOpenReport={setSelectedReportId} />
      </Panel>

      <AnimatePresence>
        {selectedReportId && <ReportReviewModal enterpriseReportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
        {isFinalizeConfirmOpen && selectedPeriod && (
          <ReportActionConfirmDialog
            title="Create immutable final report?"
            eyebrow="Exact revision finalization"
            message="This command claims only the listed accepted revision IDs and freezes the selected explicit scope into a new immutable final-report version."
            tone="emerald"
            confirmLabel="Finalize exact scope"
            pendingLabel="Finalizing…"
            isPending={finalizationMutation.isPending}
            isConfirmDisabled={!canFinalize}
            onCancel={() => setIsFinalizeConfirmOpen(false)}
            onConfirm={() => finalizationMutation.mutate()}
            details={[{ label: "Period", value: `${selectedPeriod.label} · ${selectedPeriod.naturalKey}` }, { label: "Scope", value: scopeType === "barangay" ? `Barangay · ${barangay}` : scopeType.replaceAll("_", " ") }, { label: "Exact revisions", value: acceptedRevisionIds(selectedReports).join(", ") }, { label: "Completeness", value: completeScope ? "Authoritative scope ready" : "Blocked by obligation status" }]}
          />
        )}
      </AnimatePresence>
    </PageMotion>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  const classes = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900";
  return <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${classes}`}>{children}</p>;
}

function safeIdempotencySegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function isNotFound(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
