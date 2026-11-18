import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState as DesignEmptyState } from "../../../design-system";

type EmptyStateProps = { icon: LucideIcon; title: string; description: string; minHeightClassName?: string; action?: ReactNode };

/** The design-system EmptyState, taking a lucide icon component. */
export function EmptyState({ icon: Icon, ...props }: EmptyStateProps) {
  return <DesignEmptyState icon={<Icon size={22} />} {...props} />;
}
