import type { SystemLogCategory } from "@/shared/types";
import { activityGroupClasses, systemLogTypeClasses, type ActivityGroup } from "../model";

export function ActivityGroupBadge({ group }: { group: Exclude<ActivityGroup, "All Activity"> }) {
  return <span className={`inline-flex rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${activityGroupClasses[group]}`}>{group}</span>;
}

export function SystemLogTypeBadge({ type }: { type: SystemLogCategory }) {
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${systemLogTypeClasses[type]}`}>{type}</span>;
}
