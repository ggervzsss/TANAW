import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useOperationalFinalReports, useOperationalMapEnterprises, useOperationalReports } from "@/app/hooks/useOperationalSync";
import { useAuthStore } from "@/app/store/authStore";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts/services/enterpriseAccountService";
import { useActivityLogs } from "@/features/system-logs/hooks/useActivityLogs";
import { listReportEnterprises } from "@/shared/services/reporting";
import { buildEnterpriseProfiles, indexReports, reviewersByReport } from "../model/enterpriseReports";

/** The shared key for the enterprises that send monthly reports (also used by the route prefetch). */
export const reportEnterprisesQueryKey = ["report-enterprises"];

/**
 * Everything the Enterprise Reports page reads. The enterprise and report lists are required; accounts,
 * the map, the activity log and city summaries only add contact details, cameras and report log events.
 */
export function useEnterpriseReportsData() {
  const token = useAuthStore((state) => state.token);
  const enterprisesQuery = useQuery({ queryKey: reportEnterprisesQueryKey, queryFn: listReportEnterprises, enabled: Boolean(token) });
  const reportsQuery = useOperationalReports();
  const finalReportsQuery = useOperationalFinalReports();
  const mapQuery = useOperationalMapEnterprises();
  const accountsQuery = useQuery({ queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts, enabled: Boolean(token) });
  const { logs } = useActivityLogs();

  const reports = reportsQuery.data;
  const finalReports = finalReportsQuery.data;
  const profiles = useMemo(
    () => buildEnterpriseProfiles(enterprisesQuery.data ?? [], accountsQuery.data ?? [], mapQuery.data ?? [], reports ?? []),
    [accountsQuery.data, enterprisesQuery.data, mapQuery.data, reports],
  );
  const reportIndex = useMemo(() => indexReports(reports ?? []), [reports]);
  const reviewers = useMemo(() => reviewersByReport(logs, finalReports ?? []), [finalReports, logs]);

  return {
    profiles,
    reportIndex,
    reviewers,
    logs,
    finalReports: finalReports ?? [],
    // Registration dates decide which enterprises a month lists, so wait for accounts unless they fail.
    isLoading: enterprisesQuery.isPending || reportsQuery.isPending || accountsQuery.isPending,
    isError: enterprisesQuery.isError || reportsQuery.isError,
    retry: () => Promise.all([enterprisesQuery.refetch(), reportsQuery.refetch()]),
  };
}
