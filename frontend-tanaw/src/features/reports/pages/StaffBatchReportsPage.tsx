import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useEnterpriseReports, usePeriodCompliance, useReportingPeriods } from "@/shared/hooks/useReportWorkflow";
import { createReminderIntents, finalizeReports, reportWorkflowQueryKey } from "@/shared/services/reporting";
import type { FinalReportScopeType, FinalizeReportsCommand } from "@/shared/types";
import { BatchReportsMetrics, BatchReportsStatusNotice, BatchReportsTable, BatchReportsToolbar, ReportActionConfirmDialog, ReportReviewModal } from "../components";
import { acceptedRevisionIds, actionableReportingPeriods, buildComplianceRows, defaultReportingPeriodId, deriveBatchReportView } from "../utils/reportWorkflow";

export function StaffBatchReportsPage() {
  const queryClient = useQueryClient();
  const periodsQuery = useReportingPeriods();
  const periods = useMemo(() => actionableReportingPeriods(periodsQuery.data ?? []), [periodsQuery.data]);
  const [requestedPeriodId, setRequestedPeriodId] = useState("");
  const selectedPeriodId = useMemo(() => defaultReportingPeriodId(periods, requestedPeriodId), [periods, requestedPeriodId]);
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
  const batchView = useMemo(
    () =>
      deriveBatchReportView(
        rows,
        query,
        {
          type: scopeType,
          barangay: scopeType === "barangay" ? barangay || null : null,
        },
        manualSelectedReportIds,
      ),
    [barangay, manualSelectedReportIds, query, rows, scopeType],
  );
  const selectedReports = batchView.reports;
  const selectedReportIds = useMemo(() => new Set(selectedReports.map((report) => report.enterpriseReportId)), [selectedReports]);
  const completeScope = batchView.complete;
  const canFinalize = Boolean(selectedPeriod && selectedReports.length > 0 && completeScope && !reportsQuery.isLoading && !complianceQuery.isLoading);
  const isComplianceMissing = isNotFound(complianceQuery.error);

  const reminderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPeriod) throw new Error("Select a server-returned reporting period first.");
      return createReminderIntents(selectedPeriod.reportingPeriodId, crypto.randomUUID());
    },
    onSuccess: (acknowledgement) =>
      toast.success(`${acknowledgement.createdCount} reminder intent${acknowledgement.createdCount === 1 ? "" : "s"} created; ${acknowledgement.existingCount} already existed.`),
    onError: (error) => toast.error(apiErrorMessage(error, "Reminder intents could not be created.")),
  });

  const finalizationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPeriod || !canFinalize) throw new Error("The selected reports are not ready for a final report.");
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
      toast.success(`${acknowledgement.resource.reportCode} was created successfully.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "The final report could not be created.")),
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
      <PageHeader title="Enterprise Reports" description="Review each monthly submission, then create the official final report." />

      {loadError && <Notice tone="error">Reports could not be loaded. Please try again shortly.</Notice>}
      {periods.length === 0 && !periodsQuery.isLoading && <Notice tone="warning">Reporting periods are being prepared automatically. This page will refresh shortly.</Notice>}
      {selectedPeriod && isComplianceMissing && <Notice tone="warning">Submission tracking is being prepared for this period.</Notice>}
      {selectedPeriod && complianceQuery.isError && !isComplianceMissing && <Notice tone="error">Submission tracking could not be loaded.</Notice>}

      <BatchReportsMetrics compliance={compliance} />

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
          onPeriodChange={(value) => {
            setRequestedPeriodId(value);
            setManualSelectedReportIds(new Set());
            setBarangay("");
          }}
          onScopeChange={changeScope}
          onBarangayChange={(value) => {
            setBarangay(value);
            setManualSelectedReportIds(new Set());
          }}
          onGenerate={() => setIsFinalizeConfirmOpen(true)}
        />
        <BatchReportsStatusNotice compliance={compliance} />
        {compliance && compliance.summary.notSubmitted > 0 && (
          <div className="flex justify-end border-b border-slate-200 bg-white px-5 py-3">
            <button
              type="button"
              disabled={reminderMutation.isPending}
              onClick={() => reminderMutation.mutate()}
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 disabled:opacity-50"
            >
              {reminderMutation.isPending ? "Sending reminders…" : "Send reminders"}
            </button>
          </div>
        )}
        <BatchReportsTable
          rows={batchView.visibleRows}
          isLoading={complianceQuery.isLoading}
          selectedReportIds={selectedReportIds}
          showSelection={scopeType === "enterprise_selection"}
          onToggleReport={toggleReport}
          onOpenReport={setSelectedReportId}
        />
      </Panel>

      <AnimatePresence>
        {selectedReportId && <ReportReviewModal enterpriseReportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
        {isFinalizeConfirmOpen && selectedPeriod && (
          <ReportActionConfirmDialog
            title="Create final report?"
            eyebrow="Final report"
            message="TANAW will combine the accepted reports shown here. The result will be saved as an official version."
            tone="emerald"
            confirmLabel="Create final report"
            pendingLabel="Finalizing…"
            isPending={finalizationMutation.isPending}
            isConfirmDisabled={!canFinalize}
            onCancel={() => setIsFinalizeConfirmOpen(false)}
            onConfirm={() => finalizationMutation.mutate()}
            details={[
              { label: "Reporting month", value: selectedPeriod.label },
              { label: "Coverage", value: scopeLabel(scopeType, barangay) },
              { label: "Reports included", value: String(selectedReports.length) },
              { label: "Status", value: completeScope ? "Ready" : "More reports are required" },
            ]}
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

function scopeLabel(scopeType: FinalReportScopeType, barangay: string) {
  if (scopeType === "barangay") return barangay ? `Barangay ${barangay}` : "One barangay";
  if (scopeType === "enterprise_selection") return "Selected enterprises";
  return "All enterprises";
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
