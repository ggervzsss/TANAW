import { useMemo, useState } from "react";
import type { SystemLog } from "@/shared/types";
import type { ActivityTimeRange } from "@/shared/utils";
import { filterAdminActivityLogs, getAdminActivityMetrics, type ActivityGroup } from "../model";
import { useActivityLogs } from "./useActivityLogs";

export function useAdminActivityHistory() {
  const { logs, isLoading } = useActivityLogs();
  const [query, setQuery] = useState("");
  const [activityGroup, setActivityGroup] = useState<ActivityGroup>("All Activity");
  const [timeRange, setTimeRange] = useState<ActivityTimeRange>("All Time");
  const [selectedActivity, setSelectedActivity] = useState<SystemLog | null>(null);
  const activities = useMemo(() => filterAdminActivityLogs(logs, query, activityGroup, timeRange), [activityGroup, logs, query, timeRange]);
  const metrics = useMemo(() => getAdminActivityMetrics(logs), [logs]);
  return { activities, activityGroup, isLoading, metrics, query, selectedActivity, setActivityGroup, setQuery, setSelectedActivity, setTimeRange, timeRange };
}
