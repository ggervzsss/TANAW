import { Bell, FileText, ShieldCheck } from "lucide-react";
import type { SettingSection } from "../types";

export const settingSections: SettingSection[] = [
  {
    id: "security",
    title: "Account & Security Settings",
    icon: ShieldCheck,
    fields: [
      { key: "loginAttemptLimit", label: "Failed Login Threshold", type: "select", value: 3, options: [3, 5, 10] },
      { key: "loginLockMinutes", label: "Account Lock Duration", type: "select", value: 5, options: [5, 15, 30, 60] },
    ],
  },
  {
    id: "logs",
    title: "Log Settings",
    icon: FileText,
    fields: [
      { key: "retentionDays", label: "Log Retention Period", type: "select", value: 180, options: [90, 180, 365] },
    ],
  },
  {
    id: "notifications",
    title: "Notification Settings",
    icon: Bell,
    fields: [
      { label: "Notify Camera Offline", type: "toggle", value: true },
      { label: "Notify Gateway Offline", type: "toggle", value: true },
      { label: "Notify Sync Failed", type: "toggle", value: true },
      { label: "Notify Failed Login Threshold", type: "toggle", value: true },
    ],
  },
];
