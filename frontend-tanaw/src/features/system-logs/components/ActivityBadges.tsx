import type { SystemLogCategory } from "@/shared/types";
import { activityGroupClasses, systemLogTypeClasses, type ActivityGroup } from "../model";
import { toSentenceCase } from "@/shared/utils/sentenceCase";

export function ActivityGroupBadge({ group }: { group: Exclude<ActivityGroup, "All Activity"> }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap ${activityGroupClasses[group]}`}>{toSentenceCase(group)}</span>;
}

export function SystemLogTypeBadge({ type }: { type: SystemLogCategory }) {
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap ${systemLogTypeClasses[type]}`}>{toSentenceCase(type)}</span>;
}
