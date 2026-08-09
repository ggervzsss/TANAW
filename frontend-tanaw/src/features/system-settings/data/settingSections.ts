import { Bell, Clock3, FileText, ShieldCheck } from "lucide-react";
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
    title: "Activity History",
    icon: FileText,
    fields: [{ key: "retentionDays", label: "Keep Activity History For", type: "select", value: 180, options: [90, 180, 365] }],
  },
  {
    id: "display",
    title: "Date & Time",
    icon: Clock3,
    fields: [
      {
        key: "timeFormat",
        label: "Time Display",
        description: "Choose how time appears throughout TANAW. All dates and times use Philippine Time.",
        type: "select",
        value: "12-hour",
        options: ["12-hour", "24-hour"],
      },
    ],
  },
  {
    id: "notifications",
    title: "Technical Issue Notifications",
    icon: Bell,
    fields: [
      {
        key: "cameraSessionErrorAlerts",
        label: "Camera Problems",
        description: "Notify IT when a camera problem prevents or interrupts visitor counting.",
        type: "toggle",
        value: true,
      },
      {
        key: "gatewayServiceErrorAlerts",
        label: "Desktop Application Problems",
        description: "Notify IT when an enterprise desktop application or counting service stops working.",
        type: "toggle",
        value: true,
      },
      {
        key: "syncDelayAlerts",
        label: "Visitor Data Delays",
        description: "Notify IT when visitor records remain waiting to be sent to TANAW.",
        type: "toggle",
        value: true,
      },
      {
        key: "failedLoginLockoutAlerts",
        label: "Locked Accounts",
        description: "Notify IT when repeated failed sign-in attempts temporarily lock an account.",
        type: "toggle",
        value: true,
      },
    ],
  },
];
