import { createContext, useContext, useEffect, useRef } from "react";
import type { RealtimeConnectionState, RealtimeEnvelope } from "./types";

export type RealtimeListener = (event: RealtimeEnvelope) => void;
export type RealtimeContextValue = {
  state: RealtimeConnectionState;
  subscribe: (listener: RealtimeListener) => () => void;
};

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function useRealtimeEvent(listener: RealtimeListener) {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("useRealtimeEvent must be used inside RealtimeProvider.");
  const listenerRef = useRef(listener);
  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);
  useEffect(() => context.subscribe((event) => listenerRef.current(event)), [context]);
}
