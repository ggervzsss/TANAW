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
      {
        key: "cameraSessionErrorAlerts",
        label: "Camera Session Error Alerts",
        description: "Create an IT maintenance alert when desktop telemetry reports a camera-specific session error.",
        type: "toggle",
        value: true,
      },
      {
        key: "gatewayServiceErrorAlerts",
        label: "Desktop App Error Alerts",
        description: "Create an IT maintenance alert when the desktop app or ML service reports a session error without a camera source.",
        type: "toggle",
        value: true,
      },
      {
        key: "syncDelayAlerts",
        label: "Sync Delay Alerts",
        description: "Create an IT maintenance alert when desktop telemetry has events waiting for cloud synchronization.",
        type: "toggle",
        value: true,
      },
      {
        key: "failedLoginLockoutAlerts",
        label: "Failed Login Lockout Alerts",
        description: "Create an IT security alert when an account reaches the failed-login threshold and is temporarily locked.",
        type: "toggle",
        value: true,
      },
    ],
  },
];
