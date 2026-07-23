import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeEnvelope } from "./types";

const active = { refetchType: "active" as const };

export function routeRealtimeEvent(queryClient: QueryClient, event: RealtimeEnvelope) {
  const eventType = event.event_type;
  if (eventType.startsWith("support_ticket.")) {
    return queryClient.invalidateQueries({ queryKey: ["operational", "support-tickets"], ...active });
  }
  if (eventType.startsWith("notification.")) {
    return queryClient.invalidateQueries({ queryKey: ["operational", "notifications"], ...active });
  }
  if (eventType.startsWith("alert.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["operational-alerts"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "summary"], ...active }),
    ]);
  }
  if (eventType.startsWith("account_request.") || eventType.startsWith("enterprise.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "summary"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["current-user"], ...active }),
    ]);
  }
  if (eventType.startsWith("user.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lgu-accounts"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["current-user"], ...active }),
    ]);
  }
  if (eventType === "activity.created") {
    return queryClient.invalidateQueries({ queryKey: ["activity-logs"], ...active });
  }
  if (eventType.startsWith("report.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["operational", "reports"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["report-enterprises"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "summary"], ...active }),
    ]);
  }
  if (eventType === "email_delivery.updated" || eventType === "dev_log.created") {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["email-deliveries"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["dev-deliveries"], ...active }),
    ]);
  }
  if (eventType === "telemetry.updated") {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["operational", "telemetry"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "summary"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "map-enterprises"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "visitor-insights"], ...active }),
    ]);
  }
  if (eventType === "system_setting.updated") {
    return queryClient.invalidateQueries({ queryKey: ["system-settings"], ...active });
  }
  return Promise.resolve();
}

export function resynchronizeActiveRealtimeQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["operational"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["operational-alerts"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["activity-logs"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["lgu-accounts"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["email-deliveries"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["dev-deliveries"], ...active }),
  ]);
}
