import { Bell, FileText, ShieldCheck } from "lucide-react";
import type { SettingSection } from "../types";

export const settingSections: SettingSection[] = [
  {
    id: "security",
    title: "Account & Security Settings",
    icon: ShieldCheck,
    modified: "May 18, 2026 by Mike",
    fields: [
      { label: "Session Timeout", type: "select", value: "30 minutes", options: ["15 minutes", "30 minutes", "60 minutes"] },
      { label: "Password Reset Required", type: "toggle", value: true },
      { label: "Failed Login Threshold", type: "select", value: "5 attempts", options: ["3 attempts", "5 attempts", "10 attempts"] },
      { label: "Account Lock Duration", type: "select", value: "15 minutes", options: ["15 minutes", "30 minutes", "1 hour"] },
    ],
  },
  {
    id: "logs",
    title: "Log Settings",
    icon: FileText,
    modified: "May 16, 2026 by Mike",
    fields: [
      { label: "Log Retention Period", type: "select", value: "180 days", options: ["90 days", "180 days", "365 days"] },
      { label: "Log Critical Alerts", type: "toggle", value: true },
      { label: "Log Account Changes", type: "toggle", value: true },
      { label: "Log Camera Events", type: "toggle", value: true },
    ],
  },
  {
    id: "notifications",
    title: "Notification Settings",
    icon: Bell,
    modified: "May 15, 2026 by Mike",
    fields: [
      { label: "Notify Camera Offline", type: "toggle", value: true },
      { label: "Notify Gateway Offline", type: "toggle", value: true },
      { label: "Notify Sync Failed", type: "toggle", value: true },
      { label: "Notify Failed Login Threshold", type: "toggle", value: true },
    ],
  },
];
