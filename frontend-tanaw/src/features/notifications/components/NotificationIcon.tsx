import { AlertCircle, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { PortalNotificationTone } from "../hooks/usePortalNotifications";

export function NotificationIcon({ tone, size = 17 }: { tone: PortalNotificationTone; size?: number }) {
  if (tone === "critical") return <ShieldAlert size={size} />;
  if (tone === "warning") return <AlertTriangle size={size} />;
  if (tone === "success") return <CheckCircle2 size={size} />;
  return <AlertCircle size={size} />;
}
