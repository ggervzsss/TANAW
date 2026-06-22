import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import toast from "react-hot-toast";
import { useAuthStore } from "@/app/store/authStore";
import {
  createWebSocketAuthMessage,
  getOperationalSummary,
  getOperationalWebSocketUrl,
  listFinalReports,
  listIntakeReports,
  listLatestTelemetry,
  listOperationalMapEnterprises,
  type OperationalWebSocketEnvelope,
} from "../services/operationalSync";
import type { FinalReport, IntakeReport, MapEnterprise, OperationalSummary, PriorityAlert, TelemetrySnapshot } from "../types";

export const operationalSummaryQueryKey = ["operational", "summary"];
export const operationalTelemetryQueryKey = ["operational", "telemetry", "latest"];
export const operationalReportsQueryKey = ["operational", "reports", "intake"];
export const operationalFinalReportsQueryKey = ["operational", "reports", "final"];
export const operationalMapEnterprisesQueryKey = ["operational", "map-enterprises"];
const operationalAlertsQueryKey = ["operational-alerts"];

export function useOperationalSummary() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalSummaryQueryKey, queryFn: getOperationalSummary, enabled: Boolean(token) });
}

export function useOperationalTelemetry() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalTelemetryQueryKey, queryFn: listLatestTelemetry, enabled: Boolean(token) });
}

export function useOperationalReports() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalReportsQueryKey, queryFn: listIntakeReports, enabled: Boolean(token) });
}

export function useOperationalFinalReports() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalFinalReportsQueryKey, queryFn: listFinalReports, enabled: Boolean(token) });
}

export function useOperationalMapEnterprises() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalMapEnterprisesQueryKey, queryFn: listOperationalMapEnterprises, enabled: Boolean(token) });
}

export function OperationalSyncBridge() {
  useOperationalSyncSocket();
  return null;
}

function useOperationalSyncSocket() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return undefined;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let reconnectAttempt = 0;
    let closedByEffect = false;

    const clearHeartbeat = () => {
      if (heartbeatTimer !== undefined) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const scheduleReconnect = () => {
      if (closedByEffect) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      clearHeartbeat();
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }

      socket = new WebSocket(getOperationalWebSocketUrl());

      socket.onopen = () => {
        reconnectAttempt = 0;
        socket?.send(createWebSocketAuthMessage(token));
        void queryClient.invalidateQueries({ queryKey: ["operational"] });
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 25_000);
      };

      socket.onmessage = (event) => {
        if (event.data === "pong") return;
        handleOperationalEnvelope(queryClient, event.data);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        clearHeartbeat();
        void queryClient.invalidateQueries({ queryKey: ["operational"] });
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      clearHeartbeat();
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [queryClient, token]);
}

function handleOperationalEnvelope(queryClient: ReturnType<typeof useQueryClient>, rawData: string) {
  let envelope: OperationalWebSocketEnvelope;
  try {
    envelope = JSON.parse(rawData) as OperationalWebSocketEnvelope;
  } catch {
    return;
  }

  if (envelope.type === "telemetry.snapshot") {
    const snapshot = envelope.data;
    queryClient.setQueryData<TelemetrySnapshot[]>(operationalTelemetryQueryKey, (current = []) => upsertById(current, snapshot));
    queryClient.setQueryData<MapEnterprise[]>(operationalMapEnterprisesQueryKey, (current) => updateMapEnterpriseTelemetry(current, snapshot));
    void queryClient.invalidateQueries({ queryKey: operationalMapEnterprisesQueryKey });
    return;
  }

  if (envelope.type === "summary.updated") {
    queryClient.setQueryData<OperationalSummary>(operationalSummaryQueryKey, envelope.data);
    return;
  }

  if (envelope.type === "report.submitted" || envelope.type === "report.updated") {
    const report = envelope.data;
    queryClient.setQueryData<IntakeReport[]>(operationalReportsQueryKey, (current = []) => sortReports(upsertById(current, report)));
    return;
  }

  if (envelope.type === "final_report.generated" || envelope.type === "final_report.updated") {
    const report = envelope.data;
    queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current = []) => sortFinalReports(upsertById(current, report)));
    return;
  }

  if (envelope.type === "alert.created" || envelope.type === "alert.updated" || envelope.type === "alert.resolved") {
    const alert = envelope.data;
    queryClient.setQueryData<PriorityAlert[]>(operationalAlertsQueryKey, (current = []) => sortAlerts(upsertById(current, alert)));
    if (envelope.type === "alert.created") {
      toast.error(`${alert.enterprise ?? alert.requester}: ${alert.summary}`, { id: alert.id, duration: 8000 });
    }
  }
}

function upsertById<TItem extends { id: string }>(items: TItem[], nextItem: TItem) {
  const exists = items.some((item) => item.id === nextItem.id);
  if (!exists) return [nextItem, ...items];
  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

function sortReports(reports: IntakeReport[]) {
  return [...reports].sort((left, right) => getReportTime(right) - getReportTime(left));
}

function sortFinalReports(reports: FinalReport[]) {
  return [...reports].sort((left, right) => Date.parse(right.generatedOn) - Date.parse(left.generatedOn));
}

function sortAlerts(alerts: PriorityAlert[]) {
  return [...alerts].sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
}

function getReportTime(report: IntakeReport) {
  return Date.parse(report.submittedAt ?? report.submitted);
}

function updateMapEnterpriseTelemetry(current: MapEnterprise[] | undefined, snapshot: TelemetrySnapshot) {
  if (!current) return current;

  return current.map((enterprise) => {
    if (enterprise.id !== snapshot.enterpriseId) return enterprise;

    return {
      ...enterprise,
      totalLiveOccupancy: snapshot.currentOccupancy,
      estimatedUniqueCount: snapshot.uniqueCount,
      lastSync: snapshot.receivedAt,
      gatewayStatus: snapshot.gatewayStatus,
      sourceKind: snapshot.sourceKind,
      mockRunId: snapshot.mockRunId,
      status: getMapStatus(snapshot),
    };
  });
}

function getMapStatus(snapshot: TelemetrySnapshot): MapEnterprise["status"] {
  if (snapshot.gatewayStatus === "Offline" || snapshot.error) return "Critical";
  if (snapshot.gatewayStatus === "Sync Delayed" || snapshot.unsyncedEvents > 0) return "Warning";
  return "Normal";
}
