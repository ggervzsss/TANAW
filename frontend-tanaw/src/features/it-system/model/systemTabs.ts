/** The System page's tabs, kept in `?tab=`. Activity is the default. */
export type SystemTab = "activity" | "email" | "settings";

export const SYSTEM_TAB_PARAM = "tab";
/** The expanded Activity row: `?activity=<log id>`. */
export const SYSTEM_ACTIVITY_PARAM = "activity";

export const SYSTEM_TABS: readonly { value: SystemTab; label: string }[] = [
  { value: "activity", label: "Activity" },
  { value: "email", label: "Email log" },
  { value: "settings", label: "Settings" },
];

export function parseSystemTab(value: string | null): SystemTab {
  return SYSTEM_TABS.some((tab) => tab.value === value) ? (value as SystemTab) : "activity";
}
