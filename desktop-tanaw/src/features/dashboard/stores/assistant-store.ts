import { create } from "zustand";
import type { ReportRecord } from "../../../types/enterprise";
import type { TrendFilter } from "../types/dashboard";

/** What the dashboard shows, so answers follow its date range and its latest report. */
export type AssistantDashboardContext = { filter: TrendFilter; report: ReportRecord | null };

type AssistantState = {
  /** Whether the TANAW Insights panel is open. The panel and its topbar launcher are on every page. */
  open: boolean;
  /** Set while the dashboard is on screen; null on other pages. */
  dashboard: AssistantDashboardContext | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setDashboard: (dashboard: AssistantDashboardContext | null) => void;
};

/** Shared by the shell (which renders the panel), the topbar (which holds its launcher) and the dashboard. */
export const useAssistantStore = create<AssistantState>()((set) => ({
  open: false,
  dashboard: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setDashboard: (dashboard) => set({ dashboard }),
}));

/** The topbar launcher; the panel returns focus here when it closes. */
export const ASSISTANT_LAUNCHER_ID = "tanaw-assistant-launcher";
