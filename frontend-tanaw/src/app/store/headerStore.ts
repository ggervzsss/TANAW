import { create } from "zustand";

type HeaderState = {
  title: string;
  description: string;
  setHeader: (title: string, description: string) => void;
  clearHeader: () => void;
};

export const useHeaderStore = create<HeaderState>((set) => ({
  title: "",
  description: "",
  setHeader: (title, description) => set({ title, description }),
  clearHeader: () => set({ title: "", description: "" }),
}));
