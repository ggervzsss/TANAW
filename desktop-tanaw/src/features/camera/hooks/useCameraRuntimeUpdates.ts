import { useEffect, useState } from "react";
import { createBackoffPoller } from "../../../utils/backoff-poller";
import { createReconnectingWebSocket } from "../../../utils/reconnecting-websocket";
import { getMlCameraWebSocketUrl, type MlCameraStates } from "../services/ml-service";
import { parseMlReportLiveEvent } from "../../../types/ml-report-live-events";

const ML_STATUS_FALLBACK_INTERVAL_MS = 10_000;
const ML_STATES_FALLBACK_INTERVAL_MS = 2_500;

type CameraRuntimeUpdatesOptions = {
  applyCameraStates: (payload: MlCameraStates) => void;
  baseUrl: string;
  refreshCameraStates: () => Promise<void>;
  refreshServiceStatus: () => Promise<void>;
  onServiceError: (message: string | null) => void;
};

export function useCameraRuntimeUpdates({ applyCameraStates, baseUrl, refreshCameraStates, refreshServiceStatus, onServiceError }: CameraRuntimeUpdatesOptions) {
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [resetRequired, setResetRequired] = useState(false);

  useEffect(() => {
    setResetRequired(false);
    if (window.tanawMlService) {
      setIsLiveConnected(false);
      return window.tanawMlService.subscribeToReportEvents?.((event) => {
        if (event.type === "camera.states") {
          setResetRequired(false);
          setIsLiveConnected(true);
          applyCameraStates(event.data);
          onServiceError(null);
        } else if (event.type === "disconnected") {
          setIsLiveConnected(false);
        } else if (event.type === "service.error") {
          setResetRequired(true);
          setIsLiveConnected(false);
          onServiceError(event.message);
        } else if (event.type === "connected") {
          setResetRequired(false);
        }
      });
    }
    const connection = createReconnectingWebSocket({
      url: getMlCameraWebSocketUrl(baseUrl),
      onOpen: () => setIsLiveConnected(true),
      onMessage: (event) => {
        try {
          const envelope = parseMlReportLiveEvent(event.data);
          if (envelope?.type === "camera.states") applyCameraStates(envelope.data);
          else if (envelope?.type === "service.error") {
            setResetRequired(true);
            setIsLiveConnected(false);
            onServiceError(envelope.message);
          }
        } catch {
          // Ignore malformed local service messages and wait for the next state frame.
        }
      },
      onClose: () => setIsLiveConnected(false),
    });

    return () => {
      setIsLiveConnected(false);
      connection.dispose();
    };
  }, [applyCameraStates, baseUrl, onServiceError]);

  useEffect(() => {
    void refreshServiceStatus();
    const intervalId = window.setInterval(() => void refreshServiceStatus(), ML_STATUS_FALLBACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshServiceStatus]);

  useEffect(() => {
    if (isLiveConnected || resetRequired) return undefined;
    const poller = createBackoffPoller({
      task: refreshCameraStates,
      successDelayMs: ML_STATES_FALLBACK_INTERVAL_MS,
      maxFailureDelayMs: 30_000,
    });
    return () => poller.dispose();
  }, [isLiveConnected, refreshCameraStates, resetRequired]);
}
