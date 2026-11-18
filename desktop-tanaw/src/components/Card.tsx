import type { ReactNode } from "react";
import { Card as DesignCard, cn } from "../design-system";

/** The design-system Card; tanaw-enterprise-card keeps this app's workspace-specific spacing rules. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <DesignCard className={cn("tanaw-enterprise-card", className)}>{children}</DesignCard>;
}
