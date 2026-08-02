import { DetailField, ExpandableTableText } from "@/shared/components/ui";
import type { SystemLog } from "@/shared/types";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";
import { activityGroupFor } from "../model";
import { ActivityGroupBadge } from "./ActivityBadges";

export function ActivityDetailFields({ activity, timeFormat = "12-hour", variant = "it" }: { activity: SystemLog; timeFormat?: SystemTimeFormat; variant?: "admin" | "it" }) {
  const expandableValue = (value: string, label: string) => (
    <ExpandableTableText primary={value} ariaLabel={label} twoLines className={variant === "admin" ? "leading-relaxed font-semibold" : undefined} />
  );
  if (variant === "admin")
    return (
      <div className="tanaw-detail-grid grid gap-4 md:grid-cols-2">
        <DetailField label="Date and Time" value={formatPhilippineDateTime(activity.timestamp, timeFormat)} />
        <DetailField label="Activity Type" value={<ActivityGroupBadge group={activityGroupFor(activity)} />} />
        <DetailField label="Activity" value={expandableValue(activity.action, "activity")} />
        <DetailField label="Performed By" value={expandableValue(activity.actor, "person or system")} />
        <DetailField label="Affected Item" value={expandableValue(activity.target, "affected item")} />
        <DetailField label="Details" value={expandableValue(activity.summary, "activity details")} />
      </div>
    );
  return (
    <div className="tanaw-detail-grid grid gap-4 md:grid-cols-2">
      <DetailField label="Type" value={activity.category} />
      <DetailField label="Actor" value={expandableValue(`${activity.actor} (${activity.actorRole})`, "actor")} />
      <DetailField label="Date and Time" value={formatPhilippineDateTime(activity.timestamp, timeFormat)} />
      <DetailField label="Target" value={expandableValue(activity.target, "target")} />
      <DetailField label="Action" value={expandableValue(activity.action, "action")} />
      <DetailField label="Summary" value={expandableValue(activity.summary, "summary")} />
    </div>
  );
}

export function AdminActivityDetailFields({ activity, timeFormat = "12-hour" }: { activity: SystemLog; timeFormat?: SystemTimeFormat }) {
  return <ActivityDetailFields activity={activity} timeFormat={timeFormat} variant="admin" />;
}
