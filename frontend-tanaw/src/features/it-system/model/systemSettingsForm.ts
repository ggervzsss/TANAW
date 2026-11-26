import type { SystemSettingValue } from "@/shared/services/systemSettingsService";
import { formatPhilippineDate, formatPhilippineTime, SYSTEM_DATE_FORMATS, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * The Settings tab: one form for the rules every account follows. The backend accepts only the
 * listed values for each key, so the form offers only those.
 */

export const LOGIN_ATTEMPT_OPTIONS = [3, 5, 10] as const;
export const LOGIN_LOCK_MINUTE_OPTIONS = [5, 15, 30, 60] as const;
export const CAMERA_WAIT_MINUTE_OPTIONS = [5, 15, 30, 60] as const;
export const RETENTION_DAY_OPTIONS = [90, 180, 365] as const;
export const TIME_FORMATS: readonly SystemTimeFormat[] = ["12-hour", "24-hour"];

export type SystemSettingsForm = {
  loginAttemptLimit: number;
  loginLockMinutes: number;
  cameraWaitMinutes: number;
  retentionDays: number;
  dateFormat: SystemDateFormat;
  timeFormat: SystemTimeFormat;
};

export const SETTING_KEYS: Record<keyof SystemSettingsForm, string> = {
  loginAttemptLimit: "security.loginAttemptLimit",
  loginLockMinutes: "security.loginLockMinutes",
  cameraWaitMinutes: "monitoring.cameraWaitMinutes",
  retentionDays: "logs.retentionDays",
  dateFormat: "display.dateFormat",
  timeFormat: "display.timeFormat",
};

/** What TANAW uses until someone changes a setting; the same defaults as the backend. */
export const DEFAULT_SETTINGS_FORM: SystemSettingsForm = {
  loginAttemptLimit: 3,
  loginLockMinutes: 5,
  cameraWaitMinutes: 15,
  retentionDays: 180,
  dateFormat: "MMM d, yyyy",
  timeFormat: "12-hour",
};

function allowedNumber(value: SystemSettingValue | undefined, options: readonly number[], fallback: number) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return options.includes(number) ? number : fallback;
}

function allowedText<T extends string>(value: SystemSettingValue | undefined, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

/** The form values from the saved settings, keeping only values the backend allows. */
export function settingsFormFromValues(values: Record<string, SystemSettingValue> | null | undefined): SystemSettingsForm {
  const saved = values ?? {};
  const defaults = DEFAULT_SETTINGS_FORM;
  return {
    loginAttemptLimit: allowedNumber(saved[SETTING_KEYS.loginAttemptLimit], LOGIN_ATTEMPT_OPTIONS, defaults.loginAttemptLimit),
    loginLockMinutes: allowedNumber(saved[SETTING_KEYS.loginLockMinutes], LOGIN_LOCK_MINUTE_OPTIONS, defaults.loginLockMinutes),
    cameraWaitMinutes: allowedNumber(saved[SETTING_KEYS.cameraWaitMinutes], CAMERA_WAIT_MINUTE_OPTIONS, defaults.cameraWaitMinutes),
    retentionDays: allowedNumber(saved[SETTING_KEYS.retentionDays], RETENTION_DAY_OPTIONS, defaults.retentionDays),
    dateFormat: allowedText(saved[SETTING_KEYS.dateFormat], SYSTEM_DATE_FORMATS, defaults.dateFormat),
    timeFormat: allowedText(saved[SETTING_KEYS.timeFormat], TIME_FORMATS, defaults.timeFormat),
  };
}

/** Only the settings that changed, keyed as the backend stores them. */
export function changedSettingsPayload(saved: SystemSettingsForm, draft: SystemSettingsForm) {
  const payload: Record<string, SystemSettingValue> = {};
  for (const field of Object.keys(SETTING_KEYS) as (keyof SystemSettingsForm)[]) {
    if (saved[field] !== draft[field]) payload[SETTING_KEYS[field]] = draft[field];
  }
  return payload;
}

export function isSettingsDirty(saved: SystemSettingsForm, draft: SystemSettingsForm) {
  return Object.keys(changedSettingsPayload(saved, draft)).length > 0;
}

/** A sign-in lockout change applies to every account, so the form asks before saving it. */
export function changesLockout(saved: SystemSettingsForm, draft: SystemSettingsForm) {
  return saved.loginAttemptLimit !== draft.loginAttemptLimit || saved.loginLockMinutes !== draft.loginLockMinutes;
}

export function retentionLabel(days: number) {
  return days === 365 ? "1 year" : `${days} days`;
}

/** Each date format, shown as today's date in that format. */
export function dateFormatOptions(now: Date) {
  return SYSTEM_DATE_FORMATS.map((format) => ({ value: format, label: formatPhilippineDate(now, format) }));
}

/** Each time format, shown as the time now: "3:51 PM (12-hour)". */
export function timeFormatOptions(now: Date) {
  return TIME_FORMATS.map((format) => ({ value: format, label: `${formatPhilippineTime(now, format)} (${format})` }));
}

export type ActivityCleanup = { lastRunAt?: string | null; deletedCount?: number | null };

/** "Last cleanup Nov 25, 2026 at 2:00 AM removed 312 entries." or "No cleanup yet." */
export function cleanupText(cleanup: ActivityCleanup | null | undefined, dateFormat: SystemDateFormat, timeFormat: SystemTimeFormat) {
  if (!cleanup?.lastRunAt) return "No cleanup yet.";
  const when = `${formatPhilippineDate(cleanup.lastRunAt, dateFormat)} at ${formatPhilippineTime(cleanup.lastRunAt, timeFormat)}`;
  const count = cleanup.deletedCount;
  if (count === null || count === undefined) return `Last cleanup ${when}.`;
  return `Last cleanup ${when} removed ${count.toLocaleString("en-US")} ${count === 1 ? "entry" : "entries"}.`;
}

/** "Last changed Nov 12, 2026 by Carlo Mendoza. Every change is recorded in Activity." */
export function lastChangedText(updatedAt: string | null | undefined, updatedBy: string | null | undefined, dateFormat: SystemDateFormat) {
  const audit = "Every change is recorded in Activity.";
  const date = updatedAt ? formatPhilippineDate(updatedAt, dateFormat) : null;
  if (date && updatedBy) return `Last changed ${date} by ${updatedBy}. ${audit}`;
  if (date) return `Last changed ${date}. ${audit}`;
  if (updatedBy) return `Last changed by ${updatedBy}. ${audit}`;
  return `TANAW is using the default settings. ${audit}`;
}
