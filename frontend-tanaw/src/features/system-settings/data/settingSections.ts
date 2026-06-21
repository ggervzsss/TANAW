import { Bell, Camera, FileText, ShieldCheck, Wifi } from "lucide-react";
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
      { label: "Role Permissions", type: "readonly", value: "View access rules" },
    ],
  },
  {
    id: "camera",
    title: "Camera Integration Settings",
    icon: Camera,
    modified: "May 17, 2026 by Camera service",
    fields: [
      { label: "Default RTSP Timeout", type: "select", value: "8 seconds", options: ["5 seconds", "8 seconds", "12 seconds"] },
      { label: "Camera Reconnect Interval", type: "select", value: "5 minutes", options: ["3 minutes", "5 minutes", "10 minutes"] },
      { label: "ONVIF Discovery", type: "toggle", value: true },
      { label: "Camera Health Check Interval", type: "select", value: "5 minutes", options: ["5 minutes", "10 minutes", "15 minutes"] },
      { label: "Low FPS Warning Threshold", type: "select", value: "12 FPS", options: ["10 FPS", "12 FPS", "15 FPS"] },
      { label: "Low Confidence Warning Threshold", type: "select", value: "65%", options: ["60%", "65%", "70%"] },
    ],
  },
  {
    id: "sync",
    title: "Sync Settings",
    icon: Wifi,
    modified: "May 17, 2026 by Sync service",
    fields: [
      { label: "Sync Interval", type: "select", value: "10 minutes", options: ["5 minutes", "10 minutes", "15 minutes"] },
      { label: "Retry Failed Sync", type: "toggle", value: true },
      { label: "Local Cache Retention", type: "select", value: "30 days", options: ["14 days", "30 days", "60 days"] },
      { label: "Duplicate Sync Prevention", type: "toggle", value: true },
      { label: "Offline Mode", type: "toggle", value: true },
    ],
  },
  {
    id: "logs",
    title: "Log Settings",
    icon: FileText,
    modified: "May 16, 2026 by Mike",
    fields: [
      { label: "Log Retention Period", type: "select", value: "180 days", options: ["90 days", "180 days", "365 days"] },
      { label: "Export Format", type: "select", value: "CSV", options: ["CSV", "PDF"] },
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
