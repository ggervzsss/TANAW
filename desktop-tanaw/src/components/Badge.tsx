import type { ReactNode } from "react";
import { Badge as DesignBadge, type BadgeTone } from "../design-system";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeVariant, BadgeTone> = { default: "neutral", success: "success", warning: "warning", danger: "danger", info: "info" };

/** The design-system Badge with this app's older variant names. */
export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: BadgeVariant }) {
  return <DesignBadge tone={tones[variant]}>{children}</DesignBadge>;
}
