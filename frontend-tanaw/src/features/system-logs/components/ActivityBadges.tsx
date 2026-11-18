import type { SystemLogCategory } from "@/shared/types";
import { Badge } from "../../../design-system";
import { activityGroupTones, systemLogTypeTones, type ActivityGroup } from "../model";

export function ActivityGroupBadge({ group }: { group: Exclude<ActivityGroup, "All Activity"> }) {
  return <Badge tone={activityGroupTones[group]}>{group}</Badge>;
}

export function SystemLogTypeBadge({ type }: { type: SystemLogCategory }) {
  return <Badge tone={systemLogTypeTones[type]}>{type}</Badge>;
}
