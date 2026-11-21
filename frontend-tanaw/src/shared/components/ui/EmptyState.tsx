import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState as DesignEmptyState } from "../../ui-kit";

type EmptyStateProps = { icon: LucideIcon; title: string; description: string; minHeightClassName?: string; action?: ReactNode };

/** The UI-kit EmptyState, taking a lucide icon component. */
export function EmptyState({ icon: Icon, ...props }: EmptyStateProps) {
  return <DesignEmptyState icon={<Icon size={22} />} {...props} />;
}
