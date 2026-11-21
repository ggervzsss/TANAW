import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "../../../shared/ui-kit";
import { emailDeliveryStatusLabels } from "../model";
import type { EmailDelivery } from "../services";

export function EmailDeliveryStatus({ status }: { status: EmailDelivery["status"] }) {
  const isSuccess = status === "accepted" || status === "recorded";
  const isWaiting = status === "queued" || status === "processing" || status === "retry_scheduled";
  const Icon = isSuccess ? CheckCircle2 : isWaiting ? Clock3 : AlertTriangle;
  return (
    <Badge tone={isSuccess ? "success" : isWaiting ? "warning" : "danger"}>
      <span className="inline-flex items-center gap-1.5">
        <Icon size={13} aria-hidden="true" /> {emailDeliveryStatusLabels[status]}
      </span>
    </Badge>
  );
}
