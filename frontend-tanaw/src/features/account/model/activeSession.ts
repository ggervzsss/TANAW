import { formatPhilippineDate, formatPhilippineTime, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";

/** Browsers whose user agent also names another engine are checked first. */
const browsers: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

/** iPhone and Android user agents also mention desktop systems, so they are checked first. */
const systems: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(userAgent: string, patterns: ReadonlyArray<readonly [RegExp, string]>) {
  return patterns.find(([pattern]) => pattern.test(userAgent))?.[1];
}

/** "Chrome on Windows" from a browser's user agent; "This browser" when it names neither. */
export function describeUserAgent(userAgent: string): string {
  const browser = firstMatch(userAgent, browsers);
  const system = firstMatch(userAgent, systems);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `Browser on ${system}` : "This browser");
}

/** "Signed in Nov 26, 2026 · 8:15 AM" in the system date and time formats. */
export function signedInLabel(value: string | null | undefined, dateFormat: SystemDateFormat, timeFormat: SystemTimeFormat): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Sign-in time unavailable";
  return `Signed in ${formatPhilippineDate(value, dateFormat)} · ${formatPhilippineTime(value, timeFormat)}`;
}
