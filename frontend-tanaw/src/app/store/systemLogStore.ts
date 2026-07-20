import { create } from "zustand";
import { persist } from "zustand/middleware";
import { systemLogs as initialSystemLogs } from "@/shared/data";
import type { SystemLog } from "@/shared/types";

type NewSystemLog = Omit<SystemLog, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

type SystemLogState = {
  logs: SystemLog[];
  recordLog: (log: NewSystemLog) => void;
};

export const useSystemLogStore = create<SystemLogState>()(
  persist(
    (set) => ({
      logs: initialSystemLogs,
      recordLog: (log) =>
        set((state) => ({
          logs: [
            {
              ...log,
              id: log.id ?? `LOG-${Date.now()}`,
              timestamp: log.timestamp ?? formatLogTimestamp(new Date()),
            },
            ...state.logs,
          ],
        })),
    }),
    {
      name: "tanaw-system-logs",
      version: 1,
    },
  ),
);

function formatLogTimestamp(date: Date) {
  return date.toISOString();
}
