import { useEffect, useState } from "react";
import { createBackoffPoller } from "../../../utils/backoff-poller";
import { createReconnectingWebSocket } from "../../../utils/reconnecting-websocket";
import { getMlCameraWebSocketUrl, type MlCameraLiveEnvelope, type MlCameraStates } from "../services/ml-service";

const ML_STATUS_FALLBACK_INTERVAL_MS = 10_000;
const ML_STATES_FALLBACK_INTERVAL_MS = 2_500;

type CameraRuntimeUpdatesOptions = {
  applyCameraStates: (payload: MlCameraStates) => void;
  baseUrl: string;
  refreshCameraStates: () => Promise<void>;
  refreshServiceStatus: () => Promise<void>;
};

export function useCameraRuntimeUpdates({ applyCameraStates, baseUrl, refreshCameraStates, refreshServiceStatus }: CameraRuntimeUpdatesOptions) {
  const [isLiveConnected, setIsLiveConnected] = useState(false);

  useEffect(() => {
    if (window.tanawMlService) {
      setIsLiveConnected(false);
      return undefined;
    }
    const connection = createReconnectingWebSocket({
      url: getMlCameraWebSocketUrl(baseUrl),
      onOpen: () => setIsLiveConnected(true),
      onMessage: (event) => {
        try {
          const envelope = JSON.parse(event.data) as MlCameraLiveEnvelope;
          if (envelope.type === "camera.states") applyCameraStates(envelope.data);
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
  }, [applyCameraStates, baseUrl]);

  useEffect(() => {
    void refreshServiceStatus();
    const intervalId = window.setInterval(() => void refreshServiceStatus(), ML_STATUS_FALLBACK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshServiceStatus]);

  useEffect(() => {
    if (isLiveConnected) return undefined;
    const poller = createBackoffPoller({
      task: refreshCameraStates,
      successDelayMs: ML_STATES_FALLBACK_INTERVAL_MS,
      maxFailureDelayMs: 30_000,
    });
    return () => poller.dispose();
  }, [isLiveConnected, refreshCameraStates]);
}
