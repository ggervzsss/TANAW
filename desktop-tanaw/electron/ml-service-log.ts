export type MlServiceLogLevel = "error" | "info" | "warn";

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const ERROR_PATTERN = /\b(?:CRITICAL|ERROR|FATAL)\b|Traceback \(|\b[A-Za-z]+(?:Error|Exception):/i;
const WARNING_PATTERN = /\bWARN(?:ING)?\b|⚠/i;

export function classifyMlServiceStderr(message: string): MlServiceLogLevel {
  const normalized = message.replace(ANSI_ESCAPE_PATTERN, "");
  if (ERROR_PATTERN.test(normalized)) return "error";
  if (WARNING_PATTERN.test(normalized)) return "warn";
  return "info";
}
