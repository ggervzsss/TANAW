import { useMemo, useState } from "react";
import type { SystemLog } from "@/shared/types";
import type { ActivityTimeRange } from "@/shared/utils";
import { filterITSystemLogs, getAccountOptions, getTypeOptions } from "../model";
import { useActivityLogs } from "./useActivityLogs";

export function useITSystemLogsPage() {
  const { logs, isLoading } = useActivityLogs();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [accountFilter, setAccountFilter] = useState("All Accounts");
  const [timeRange, setTimeRange] = useState<ActivityTimeRange>("All Time");
  const [showRoutineActivity, setShowRoutineActivity] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<SystemLog | null>(null);
  const typeOptions = useMemo(() => getTypeOptions(logs, accountFilter), [accountFilter, logs]);
  const accountOptions = useMemo(() => getAccountOptions(logs, typeFilter), [logs, typeFilter]);
  const activities = useMemo(
    () => filterITSystemLogs(logs, { account: accountFilter, query, showRoutine: showRoutineActivity, timeRange, type: typeFilter }),
    [accountFilter, logs, query, showRoutineActivity, timeRange, typeFilter],
  );

  const changeTypeFilter = (value: string) => {
    setTypeFilter(value);
    if (!getAccountOptions(logs, value).includes(accountFilter)) setAccountFilter("All Accounts");
  };
  const changeAccountFilter = (value: string) => {
    setAccountFilter(value);
    if (!getTypeOptions(logs, value).includes(typeFilter)) setTypeFilter("All Types");
  };

  return {
    accountFilter,
    accountOptions,
    activities,
    changeAccountFilter,
    changeTypeFilter,
    isLoading,
    query,
    selectedActivity,
    setQuery,
    setSelectedActivity,
    setShowRoutineActivity,
    setTimeRange,
    showRoutineActivity,
    timeRange,
    typeFilter,
    typeOptions,
  };
}
