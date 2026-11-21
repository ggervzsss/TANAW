import type { ReactNode } from "react";
import { Card as DesignCard, cn } from "../ui-kit";

/** The UI-kit Card; tanaw-enterprise-card keeps this app's workspace-specific spacing rules. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <DesignCard className={cn("tanaw-enterprise-card", className)}>{children}</DesignCard>;
}
