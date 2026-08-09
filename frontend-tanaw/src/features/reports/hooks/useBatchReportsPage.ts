import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { operationalFinalReportsQueryKey, operationalReportsQueryKey, useOperationalReports } from "@/shared/hooks/useOperationalSync";
import { useScopedPageState } from "@/shared/hooks/useScopedPageState";
import { createFinalReport, listReportEnterprises, updateIntakeReportStatus } from "@/shared/services/reporting";
import type { IntakeReport, ReportEnterprise, ReportStatus } from "@/shared/types";
import {
  ALL_BARANGAYS_FILTER,
  batchReportsSearchParams,
  hasBatchReportsUrlState,
  isBatchReportsPageState,
  parseBatchReportsUrlState,
  sameBatchReportsPageState,
  type BatchReportsPageState,
} from "../model";
import { getAvailableMonths, getAvailableYears, getCurrentSubmissionPeriod, getDefaultSubmissionPeriod, getEnterpriseReportRows, reportMatchesPeriod } from "../utils";

const EMPTY_ENTERPRISES: ReportEnterprise[] = [];
const EMPTY_REPORTS: IntakeReport[] = [];

export function useBatchReportsPage() {
  const authUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const enterprisesQuery = useQuery({ queryKey: ["report-enterprises"], queryFn: listReportEnterprises });
  const reportsQuery = useOperationalReports();
  const reportEnterprises = enterprisesQuery.data ?? EMPTY_ENTERPRISES;
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const currentPeriod = getCurrentSubmissionPeriod();
  const defaultPeriod = getDefaultSubmissionPeriod(reports, currentPeriod);
  const [searchParams, setSearchParams] = useSearchParams();
  const [hasInitialUrlState] = useState(() => hasBatchReportsUrlState(searchParams));
  const [initialPageState] = useState<BatchReportsPageState>(() =>
    parseBatchReportsUrlState(searchParams, { barangay: ALL_BARANGAYS_FILTER, month: defaultPeriod.month, query: "", year: defaultPeriod.year }),
  );
  const [pageState, setPageState] = useScopedPageState({ initialValue: initialPageState, isValid: isBatchReportsPageState, namespace: "filters", preferInitial: hasInitialUrlState, version: 1 });
  const [selectedEnterprise, setSelectedEnterprise] = useState<ReportEnterprise | null>(null);
  const [selectedReport, setSelectedReport] = useState<IntakeReport | null>(null);
  const [isGenerateConfirmOpen, setIsGenerateConfirmOpen] = useState(false);
  const initializedUrlRef = useRef(false);
  const [firstPageState] = useState(pageState);

  useEffect(() => {
    if (!initializedUrlRef.current) {
      initializedUrlRef.current = true;
      const initialParams = batchReportsSearchParams(firstPageState);
      if (initialParams.toString() !== searchParams.toString()) setSearchParams(initialParams, { replace: true });
      return;
    }
    setPageState((current) => {
      const urlState = parseBatchReportsUrlState(searchParams, current);
      return sameBatchReportsPageState(urlState, current) ? current : urlState;
    });
  }, [firstPageState, searchParams, setPageState, setSearchParams]);

  const updatePageState = (patch: Partial<BatchReportsPageState>) => {
    const nextState = { ...pageState, ...patch };
    setPageState(nextState);
    setSearchParams(batchReportsSearchParams(nextState), { replace: true });
  };
  const availableMonths = useMemo(() => getAvailableMonths(reports, currentPeriod), [currentPeriod, reports]);
  const availableYears = useMemo(() => getAvailableYears(reports, currentPeriod), [currentPeriod, reports]);
  const availableBarangays = useMemo(() => Array.from(new Set(reportEnterprises.map((enterprise) => enterprise.barangay).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [reportEnterprises]);
  const selectedReportEnterprises = useMemo(
    () => (pageState.barangay === ALL_BARANGAYS_FILTER ? reportEnterprises : reportEnterprises.filter((enterprise) => enterprise.barangay === pageState.barangay)),
    [pageState.barangay, reportEnterprises],
  );
  const selectedEnterpriseIds = useMemo(() => new Set(selectedReportEnterprises.map((enterprise) => enterprise.id)), [selectedReportEnterprises]);
  const reportsForBarangay = useMemo(
    () => (pageState.barangay === ALL_BARANGAYS_FILTER ? reports : reports.filter((report) => selectedEnterpriseIds.has(report.enterpriseId))),
    [pageState.barangay, reports, selectedEnterpriseIds],
  );
  const filteredByPeriod = useMemo(() => reportsForBarangay.filter((report) => reportMatchesPeriod(report, pageState.month, pageState.year)), [pageState.month, pageState.year, reportsForBarangay]);
  const nonPeriodReports = useMemo(() => reportsForBarangay.filter((report) => !filteredByPeriod.includes(report) || report.status === "Consolidated"), [reportsForBarangay, filteredByPeriod]);
  const readyReports = filteredByPeriod.filter((report) => report.status === "Ready to Consolidate");
  const enterpriseRows = useMemo(
    () => getEnterpriseReportRows(selectedReportEnterprises, filteredByPeriod, nonPeriodReports, pageState.query),
    [filteredByPeriod, nonPeriodReports, pageState.query, selectedReportEnterprises],
  );
  const missingReports = enterpriseRows.filter((row) => row.status === "Missing");
  const allReady =
    selectedReportEnterprises.length > 0 &&
    selectedReportEnterprises.every((enterprise) => filteredByPeriod.find((report) => report.enterpriseId === enterprise.id)?.status === "Ready to Consolidate");
  const allConsolidated =
    selectedReportEnterprises.length > 0 && selectedReportEnterprises.every((enterprise) => filteredByPeriod.find((report) => report.enterpriseId === enterprise.id)?.status === "Consolidated");

  const updateStatusMutation = useMutation({
    mutationFn: ({ report, status, remarks }: { report: IntakeReport; status: Extract<ReportStatus, "Ready to Consolidate" | "Returned">; remarks: string }) =>
      updateIntakeReportStatus(report.id, { status, remarks }),
    onSuccess: (updatedReport) => {
      queryClient.setQueryData<IntakeReport[]>(operationalReportsQueryKey, (current = []) => current.map((report) => (report.id === updatedReport.id ? updatedReport : report)));
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      setSelectedReport(null);
      toast.success(`${updatedReport.code} updated to ${updatedReport.status}.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Report status could not be updated. Refresh the report list and try again.")),
  });
  const consolidateMutation = useMutation({
    mutationFn: async () => {
      if (!allReady || !readyReports.length) throw new Error("No ready reports available for consolidation.");
      return createFinalReport({ reportIds: readyReports.map((report) => report.id), preparedBy: authUser?.displayName ?? "LGU Staff" });
    },
    onSuccess: (finalReport) => {
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
      setIsGenerateConfirmOpen(false);
      toast.success(`${finalReport.id} generated for Final Reports Audit.`);
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Final report could not be generated.")),
  });

  const reviewReport = (report: IntakeReport, remarks: string, status: Extract<ReportStatus, "Ready to Consolidate" | "Returned">) => {
    if (report.status !== "Pending Review") return void toast.error(`Only reports pending review can be ${status === "Returned" ? "returned" : "accepted"}.`);
    updateStatusMutation.mutate({ report, status, remarks: remarks.trim() || (status === "Returned" ? "Returned for revision after staff review." : "Accepted for consolidation.") });
  };

  return {
    allConsolidated,
    allReady,
    availableBarangays,
    availableMonths,
    availableYears,
    consolidateMutation,
    enterpriseRows,
    filteredByPeriod,
    isGenerateConfirmOpen,
    isLoadingRows: enterprisesQuery.isLoading || reportsQuery.isLoading,
    loadError: enterprisesQuery.isError || reportsQuery.isError,
    missingReports,
    nonPeriodReports,
    pageState,
    readyReports,
    reports,
    reviewReport,
    selectedEnterprise,
    selectedReport,
    selectedReportEnterprises,
    setIsGenerateConfirmOpen,
    setSelectedEnterprise,
    setSelectedReport,
    updatePageState,
    updateStatusMutation,
  };
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
