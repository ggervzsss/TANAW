import { Monitor, Moon, Sun } from "lucide-react";
import { Card } from "../../../components/Card";
import type { ThemePreference } from "../../../types/enterprise";

type ThemePreferencePanelProps = {
  theme: ThemePreference;
  setTheme: React.Dispatch<React.SetStateAction<ThemePreference>>;
};

export function ThemePreferencePanel({ theme, setTheme }: ThemePreferencePanelProps) {
  return (
    <Card className="rounded-[28px] border-emerald-100/80 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.07)]">
      <h3 className="mb-4 flex items-center gap-2 border-b border-emerald-100 pb-3 text-sm font-bold tracking-wider text-[#111827] uppercase">
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-[#065f46]">
          <Moon size={16} />
        </span>
        Theme Preference
      </h3>
      <p className="mb-4 text-xs font-medium text-gray-500">Select your global interface aesthetic.</p>
      <div className="flex rounded-2xl border border-gray-200 bg-gray-100 p-1 shadow-inner">
        <button
          onClick={() => setTheme("light")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2 text-[10px] font-bold transition-colors sm:px-3 sm:text-xs ${theme === "light" ? "bg-white text-[#111827] shadow-sm dark:bg-[#0f172a] dark:text-white" : "text-gray-500 hover:text-[#111827] dark:text-gray-300 dark:hover:text-white"}`}
        >
          <Sun size={14} /> Light
        </button>
        <button
          onClick={() => setTheme("dark")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2 text-[10px] font-bold transition-colors sm:px-3 sm:text-xs ${theme === "dark" ? "bg-white text-[#111827] shadow-sm dark:bg-[#0f172a] dark:text-white" : "text-gray-500 hover:text-[#111827] dark:text-gray-300 dark:hover:text-white"}`}
        >
          <Moon size={14} /> Dark
        </button>
        <button
          onClick={() => setTheme("system")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2 text-[10px] font-bold transition-colors sm:px-3 sm:text-xs ${theme === "system" ? "bg-white text-[#111827] shadow-sm dark:bg-[#0f172a] dark:text-white" : "text-gray-500 hover:text-[#111827] dark:text-gray-300 dark:hover:text-white"}`}
        >
          <Monitor size={14} /> System
        </button>
      </div>
    </Card>
  );
}
