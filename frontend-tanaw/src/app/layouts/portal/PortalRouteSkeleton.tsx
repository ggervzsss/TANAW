import { ViewSkeleton } from "@/shared/ui-kit/patterns/ViewSkeleton";
import { portalPageShape } from "./portalPageShape";

/** A whole-page skeleton in the shape of the portal page at `pathname` (see portalPageShape). */
export function PortalRouteSkeleton({ pathname, label, className }: { pathname: string; label: string; className?: string }) {
  return <ViewSkeleton {...portalPageShape(pathname)} label={label} className={className} />;
}
