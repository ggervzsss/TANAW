import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../../../design-system";

type BadgeTone_ = "blue" | "green" | "slate" | "teal" | "amber" | "red";

const tones: Record<BadgeTone_, BadgeTone> = { blue: "info", green: "success", slate: "neutral", teal: "teal", amber: "warning", red: "danger" };

/** The design-system Badge with this app's older colour names. */
export function StatusBadge({ children, tone = "slate" }: { children: ReactNode; tone?: BadgeTone_ }) {
  return <Badge tone={tones[tone]}>{children}</Badge>;
}
