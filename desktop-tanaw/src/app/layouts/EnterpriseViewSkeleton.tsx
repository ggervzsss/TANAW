import { CameraSetupSkeleton } from "../../features/camera/components/CameraSetupSkeleton";
import { DashboardSkeleton } from "../../features/dashboard/components/DashboardSkeleton";
import { HelpCenterSkeleton } from "../../features/help/components/HelpCenterSkeleton";
import { ReportsSkeleton } from "../../features/reports/components/ReportsSkeleton";
import type { EnterpriseView } from "../../types/enterprise";
import { useSkeletonScreen } from "../../ui-kit/lib/skeleton";
import { ViewSkeleton } from "../../ui-kit/patterns/ViewSkeleton";

/**
 * A skeleton in the shape of the page that is loading, so the layout never jumps when it arrives.
 * Profile, Password & Security and Requests are sections of General Settings.
 */
export function EnterpriseViewSkeleton({ view }: { view: EnterpriseView }) {
  // Lets the page that replaces it fade in, when it was up long enough to be seen.
  useSkeletonScreen();
  switch (view) {
    case "dashboard":
      return <DashboardSkeleton />;
    case "cameras":
      return <CameraSetupSkeleton />;
    case "reports":
      return <ReportsSkeleton />;
    case "help":
      return <HelpCenterSkeleton />;
    case "notifications":
      return <ViewSkeleton variant="list" label="Loading notifications" />;
    default:
      return <ViewSkeleton variant="settings" label="Loading settings" />;
  }
}
