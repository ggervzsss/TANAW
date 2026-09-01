import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOperationalReports } from "@/app/hooks/useOperationalSync";
import { listReportEnterprises } from "@/shared/services/reporting";
import { getAnalyticsPeriods, getBarangayComplianceRows, getCurrentAnalyticsPeriod, getEnterpriseReportRows, getEnterpriseTrafficRows, getTrendLabel, sumReportMetric } from "../model";

const EMPTY_LIST: never[] = [];

export function useStaffAnalytics() {
  const reportsQuery = useOperationalReports();
  const enterpriseQuery = useQuery({ queryKey: ["report-enterprises"], queryFn: listReportEnterprises });
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  const reports = reportsQuery.data ?? EMPTY_LIST;
  const enterprises = enterpriseQuery.data ?? EMPTY_LIST;
  const currentPeriod = useMemo(() => getCurrentAnalyticsPeriod(), []);
  const periods = useMemo(() => getAnalyticsPeriods(reports, currentPeriod), [currentPeriod, reports]);
  const activePeriodIndex = Math.max(
    periods.findIndex((period) => period.key === selectedPeriodKey),
    0,
  );
  const activePeriod = periods[activePeriodIndex];
  const activeReports = activePeriod?.reports ?? EMPTY_LIST;
  const enterpriseRows = useMemo(() => getEnterpriseReportRows(enterprises, activeReports), [activeReports, enterprises]);
  const submittedCount = enterpriseRows.filter((row) => row.submitted).length;
  const totalReports = enterprises.length;
  return {
    activePeriod,
    chartData: getEnterpriseTrafficRows(enterpriseRows),
    complianceRows: getBarangayComplianceRows(enterpriseRows),
    entries: sumReportMetric(activeReports, "entry"),
    enterpriseLoading: enterpriseQuery.isLoading,
    pendingCount: Math.max(0, totalReports - submittedCount),
    periods,
    reportsLoading: reportsQuery.isLoading,
    selectedPeriodKey,
    setSelectedPeriodKey,
    submissionRate: totalReports === 0 ? 0 : Math.round((submittedCount / totalReports) * 100),
    submittedCount,
    totalReports,
    trendLabel: getTrendLabel(activeReports, periods[activePeriodIndex + 1]),
    unique: sumReportMetric(activeReports, "unique"),
  };
}

export type StaffAnalyticsViewModel = ReturnType<typeof useStaffAnalytics>;
