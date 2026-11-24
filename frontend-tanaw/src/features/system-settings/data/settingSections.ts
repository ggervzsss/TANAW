import { Camera, Clock3, FileText, ShieldCheck } from "lucide-react";
import type { SettingSection } from "../types";

export const settingSections: SettingSection[] = [
  {
    id: "security",
    title: "Account & Security Settings",
    description: "Control how TANAW responds to repeated unsuccessful sign-in attempts.",
    icon: ShieldCheck,
    fields: [
      { key: "loginAttemptLimit", label: "Failed Login Threshold", type: "select", value: 3, options: [3, 5, 10] },
      { key: "loginLockMinutes", label: "Account Lock Duration", type: "select", value: 5, options: [5, 15, 30, 60] },
    ],
  },
  {
    id: "logs",
    title: "Activity History",
    description: "Choose how long System Activity remains visible and remove expired records when needed.",
    icon: FileText,
    fields: [{ key: "retentionDays", label: "Keep Activity History For", type: "select", value: 180, options: [90, 180, 365] }],
  },
  {
    id: "display",
    title: "Date & Time",
    description: "Set the time format used throughout TANAW. All timestamps remain in Philippine Time.",
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
    id: "monitoring",
    title: "Camera Alerts",
    description: "Choose how long a camera must stop counting before TANAW shows a Camera not counting alert. Short drops never raise an alert.",
    icon: Camera,
    fields: [{ key: "cameraWaitMinutes", label: "Camera Wait Time", type: "select", value: 15, options: [5, 15, 30, 60] }],
  },
];
