import { activityKindChipLabels, activityKind } from "@/features/system-logs/model/recentActivity";
import type { Request } from "@/shared/services/requests";
import type { RecordStatusTone } from "@/shared/ui-kit/lib/recordStatus";
import type { SystemLog } from "@/shared/types";

/* The two lists at the bottom of the dashboard: the latest activity and the latest requests. */

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The newest `limit` activity records. */
export function latestActivity(logs: readonly SystemLog[], limit = 3) {
  return [...logs].sort((left, right) => timestamp(right.timestamp) - timestamp(left.timestamp) || left.id.localeCompare(right.id)).slice(0, limit);
}

/** The short tag at the end of an activity row: its Activity group. */
export function activityTag(log: Pick<SystemLog, "group">) {
  return activityKindChipLabels[activityKind(log as SystemLog)];
}

export type RequestProgress = "In progress" | "Resolved" | "Approved";

export const requestProgressTone: Record<RequestProgress, RecordStatusTone> = {
  "In progress": "reviewing",
  Resolved: "consolidated",
  Approved: "consolidated",
};

export function requestProgress(status: Request["status"]): RequestProgress {
  return status === "In Progress" ? "In progress" : status;
}

export type RecentRequest = {
  key: string;
  title: string;
  place: string;
  time: string;
  progress: RequestProgress;
  /** Query string that opens this request on the Requests page. */
  search: string;
};

/** The newest `limit` requests, by when they last changed. */
export function latestRequests(requests: readonly Request[], limit = 3): RecentRequest[] {
  return requests
    .map((request) => ({
      key: request.id,
      title: request.title,
      place: request.enterpriseName ?? request.requesterName,
      time: request.updatedAt || request.createdAt,
      progress: requestProgress(request.status),
      search: `?${new URLSearchParams({ request: request.id })}`,
    }))
    .sort((left, right) => timestamp(right.time) - timestamp(left.time) || left.key.localeCompare(right.key))
    .slice(0, limit);
}
