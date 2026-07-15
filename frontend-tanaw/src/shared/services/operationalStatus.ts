import { apiClient } from "../lib/apiClient";

export type OperationalLag = {
  observations: number;
  latestSeconds: number | null;
  maximumSeconds: number | null;
};

export type OperationalStatus = {
  observedAt: string;
  processInstanceOnly: boolean;
  counters: Record<string, number>;
  finalizationScopes: Record<string, number>;
  telemetryObservedToReceivedLag: OperationalLag;
  domainEventPublishLag: OperationalLag;
  domainEventQueue: {
    pending: number;
    leased: number;
    retryScheduled: number;
    delivered: number;
    deadLetter: number;
    oldestPendingAt: string | null;
    oldestPendingAgeSeconds: number | null;
    oldestReadyAt: string | null;
    oldestLeaseExpiryAt: string | null;
  };
  officialLiveSites: {
    fresh: number;
    stale: number;
    offline: number;
    unobserved: number;
  };
};

export async function getOperationalStatus(): Promise<OperationalStatus> {
  const response = await apiClient.get<OperationalStatus>("/maintenance/operations");
  return response.data;
}
