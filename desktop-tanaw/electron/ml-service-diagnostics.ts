import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export function redactMlDiagnostic(message: string): string {
  return message
    .replace(/\b(rtsps?:\/\/)[^\s/]*@/gi, "$1[redacted]@")
    .replace(/\bBearer\s+[^\s"',]+/gi, "Bearer [redacted]")
    .replace(/((?:TANAW_ML_SERVICE_TOKEN|X-TANAW-ML-Token|password|access_token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}]+)/gi, "$1[redacted]");
}

export function createMlDiagnosticLog(directory: string) {
  const file = path.join(directory, "ml-service.log");
  const write = (message: string) => {
    try {
      mkdirSync(directory, { recursive: true });
      if (existsSync(file) && statSync(file).size > 1024 * 1024) {
        const previous = path.join(directory, "ml-service.previous.log");
        if (existsSync(previous)) unlinkSync(previous);
        renameSync(file, previous);
      }
      appendFileSync(file, `${new Date().toISOString()} ${redactMlDiagnostic(message)}\n`, { mode: 0o600 });
    } catch {
      // Diagnostic storage must never stop the camera service from starting.
    }
  };
  return { file, write };
}

// Buffer complete lines so credentials split across process output chunks are
// redacted together. Discard overlong lines rather than emitting a secret tail.
export function createMlDiagnosticOutput(emit: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let discarding = false;
  const accept = (text: string) => {
    for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const complete = part.endsWith("\n");
      if (!discarding) pending += part;
      if (pending.length > 65_536) {
        pending = "";
        discarding = true;
      }
      if (complete) {
        if (!discarding && pending.trim()) emit(redactMlDiagnostic(pending.trim()));
        pending = "";
        discarding = false;
      }
    }
  };
  return {
    push(chunk: Buffer) {
      accept(decoder.write(chunk));
    },
    flush() {
      accept(decoder.end());
      if (!discarding && pending.trim()) emit(redactMlDiagnostic(pending.trim()));
      pending = "";
    },
  };
}
