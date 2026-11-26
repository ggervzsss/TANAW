import { create } from "zustand";

type AssistantState = {
  /** Whether the dashboard shows the TANAW Insights panel. */
  open: boolean;
  /** True while the dashboard is on screen, so the topbar knows to offer the launcher. */
  available: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setAvailable: (available: boolean) => void;
};

/** Shared by the dashboard (which renders the panel) and the topbar (which holds its launcher). */
export const useAssistantStore = create<AssistantState>()((set) => ({
  open: false,
  available: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setAvailable: (available) => set(available ? { available } : { available, open: false }),
}));

/** The topbar launcher; the panel returns focus here when it closes. */
export const ASSISTANT_LAUNCHER_ID = "tanaw-assistant-launcher";
