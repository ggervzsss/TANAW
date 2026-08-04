import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import { emailDeliveryStatusLabels } from "../model";
import type { EmailDelivery } from "../services";

export function EmailDeliveryStatus({ status }: { status: EmailDelivery["status"] }) {
  const isSuccess = status === "accepted" || status === "recorded";
  const isWaiting = status === "queued" || status === "processing" || status === "retry_scheduled";
  const Icon = isSuccess ? CheckCircle2 : isWaiting ? Clock3 : AlertTriangle;
  const className = isSuccess ? "bg-emerald-50 text-emerald-700" : isWaiting ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return (
    <span className={`${className} inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black tracking-wide uppercase`}>
      <Icon size={13} /> {emailDeliveryStatusLabels[status]}
    </span>
  );
}
