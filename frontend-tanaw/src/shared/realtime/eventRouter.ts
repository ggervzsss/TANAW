import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryKeys } from "../constants/queryKeys";
import { currentUserQueryKey } from "../services/accountService";
import type { RealtimeEnvelope } from "./types";

const active = { refetchType: "active" as const };

const deferredRefetches = new WeakMap<QueryClient, Map<string, QueryKey>>();

function isDocumentHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Refetch active queries now, or, while the tab is hidden, mark them stale and
 * refetch each key once when the tab becomes visible. Desktop telemetry can
 * arrive every second, so this keeps background tabs from refetching on every
 * update while still showing current data as soon as the tab is opened.
 */
function invalidateWhenVisible(queryClient: QueryClient, queryKey: QueryKey) {
  if (!isDocumentHidden()) {
    return queryClient.invalidateQueries({ queryKey, ...active });
  }
  let deferred = deferredRefetches.get(queryClient);
  if (!deferred) {
    const pending = new Map<string, QueryKey>();
    deferred = pending;
    deferredRefetches.set(queryClient, pending);
    const flush = () => {
      if (isDocumentHidden()) return;
      document.removeEventListener("visibilitychange", flush);
      deferredRefetches.delete(queryClient);
      // cancelRefetch: false joins a refetch the focus handler already started.
      void Promise.all([...pending.values()].map((key) => queryClient.invalidateQueries({ queryKey: key, ...active }, { cancelRefetch: false })));
    };
    document.addEventListener("visibilitychange", flush);
  }
  deferred.set(JSON.stringify(queryKey), queryKey);
  return queryClient.invalidateQueries({ queryKey, refetchType: "none" });
}

export function routeRealtimeEvent(queryClient: QueryClient, event: RealtimeEnvelope) {
  const eventType = event.event_type;
  if (eventType.startsWith("request.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["operational", "requests"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["activity-logs"], ...active }),
    ]);
  }
  if (eventType.startsWith("notification.")) {
    return queryClient.invalidateQueries({ queryKey: ["operational", "notifications"], ...active });
  }
  if (eventType.startsWith("alert.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["operational-alerts"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "map-enterprises"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "summary"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["activity-logs"], ...active }),
    ]);
  }
  if (eventType.startsWith("account_request.") || eventType.startsWith("enterprise.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.enterpriseAccounts, ...active }),
      queryClient.invalidateQueries({ queryKey: ["operational", "summary"], ...active }),
      queryClient.invalidateQueries({ queryKey: ["enterprise-health"], ...active }),
      queryClient.invalidateQueries({ queryKey: currentUserQueryKey, ...active }),
    ]);
  }
  if (eventType.startsWith("user.")) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.lguAccounts, ...active }),
      queryClient.invalidateQueries({ queryKey: queryKeys.enterpriseAccounts, ...active }),
      queryClient.invalidateQueries({ queryKey: currentUserQueryKey, ...active }),
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
    return Promise.all([queryClient.invalidateQueries({ queryKey: ["email-deliveries"], ...active }), queryClient.invalidateQueries({ queryKey: queryKeys.devDeliveries, ...active })]);
  }
  if (eventType === "telemetry.updated") {
    return Promise.all([
      invalidateWhenVisible(queryClient, ["operational", "telemetry"]),
      invalidateWhenVisible(queryClient, ["operational", "summary"]),
      invalidateWhenVisible(queryClient, ["operational", "map-enterprises"]),
      invalidateWhenVisible(queryClient, ["operational", "visitor-insights"]),
      invalidateWhenVisible(queryClient, ["enterprise-health"]),
    ]);
  }
  if (eventType === "system_setting.updated") {
    return queryClient.invalidateQueries({ queryKey: queryKeys.systemSettings, ...active });
  }
  return Promise.resolve();
}

export function resynchronizeActiveRealtimeQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["operational"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["operational-alerts"], ...active }),
    queryClient.invalidateQueries({ queryKey: ["activity-logs"], ...active }),
    queryClient.invalidateQueries({ queryKey: queryKeys.enterpriseAccounts, ...active }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lguAccounts, ...active }),
    queryClient.invalidateQueries({ queryKey: ["email-deliveries"], ...active }),
    queryClient.invalidateQueries({ queryKey: queryKeys.devDeliveries, ...active }),
  ]);
}
