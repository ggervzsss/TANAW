import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/app/store/authStore";
import type { AuthUser } from "../types";
import {
  enterpriseReportDetailQueryKey,
  enterpriseReportListQueryKey,
  finalReportDetailQueryKey,
  finalReportListQueryKey,
  listAllEnterpriseReports,
  listAllFinalReports,
  listAllReportingPeriods,
  readEnterpriseReport,
  readFinalReport,
  readPeriodCompliance,
  reportComplianceQueryKey,
  reportingPeriodListQueryKey,
  type EnterpriseReportFilters,
  type FinalReportFilters,
  type ReportingPeriodFilters,
} from "../services/reporting";

export function reportingAccountScope(user: AuthUser | null) {
  return {
    accountId: user?.id ?? "anonymous",
    role: user?.role ?? "anonymous",
    enterpriseId: user?.enterpriseId ?? null,
  } as const;
}

export function useEnterpriseReports(filters: EnterpriseReportFilters = {}, enabled = true) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  return useQuery({
    queryKey: [...enterpriseReportListQueryKey, reportingAccountScope(user), filters],
    queryFn: () => listAllEnterpriseReports(filters),
    enabled: Boolean(token && user?.role === "staff" && enabled),
  });
}

export function useReportingPeriods(filters: ReportingPeriodFilters = {}) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  return useQuery({
    queryKey: [...reportingPeriodListQueryKey, reportingAccountScope(user), filters],
    queryFn: () => listAllReportingPeriods(filters),
    enabled: Boolean(token && user?.role === "staff"),
    refetchInterval: (query) => (query.state.data?.length ? false : 5000),
  });
}

export function useEnterpriseReportDetail(enterpriseReportId: string | null) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  return useQuery({
    queryKey: [...enterpriseReportDetailQueryKey, reportingAccountScope(user), enterpriseReportId],
    queryFn: () => readEnterpriseReport(requireResourceId(enterpriseReportId, "enterprise report")),
    enabled: Boolean(token && user?.role === "staff" && enterpriseReportId),
  });
}

export function usePeriodCompliance(reportingPeriodId: string | null) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  return useQuery({
    queryKey: [...reportComplianceQueryKey, reportingAccountScope(user), reportingPeriodId],
    queryFn: () => readPeriodCompliance(requireResourceId(reportingPeriodId, "reporting period")),
    enabled: Boolean(token && user?.role === "staff" && reportingPeriodId),
    retry: false,
  });
}

export function useFinalReports(filters: FinalReportFilters = {}) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  return useQuery({
    queryKey: [...finalReportListQueryKey, reportingAccountScope(user), filters],
    queryFn: () => listAllFinalReports(filters),
    enabled: Boolean(token && user?.role === "staff"),
  });
}

export function useFinalReportDetail(reportFinalizationId: string | null, versionId?: string) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  return useQuery({
    queryKey: [...finalReportDetailQueryKey, reportingAccountScope(user), reportFinalizationId, versionId ?? "current"],
    queryFn: () => readFinalReport(requireResourceId(reportFinalizationId, "final report"), versionId),
    enabled: Boolean(token && user?.role === "staff" && reportFinalizationId),
  });
}

function requireResourceId(value: string | null, resourceName: string) {
  if (!value) throw new Error(`A ${resourceName} ID is required.`);
  return value;
}
