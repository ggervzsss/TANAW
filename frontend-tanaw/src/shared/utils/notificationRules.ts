import type { BackendNotification } from "@/shared/services/operationalSync";

export function isStaffReportSubmissionNotification(notification: BackendNotification) {
  return (
    notification.sourceType === "enterprise.report" &&
    (notification.type === "Enterprise Report Submitted" || notification.type === "Enterprise Report Resubmitted")
  );
}
