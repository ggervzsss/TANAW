import { Console } from "node:console";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { formatWithOptions } from "node:util";
import { redactMlDiagnostic } from "./ml-service-diagnostics";

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_RECORD_CHARS = 65_536;

// Electron's console can throw synchronously when its inherited output pipe has
// lost its reader. A Console backed by our own transports also protects logging
// inside Electron itself (notably ipc-dispatch's replyWithError).
export function createMainProcessLogging(directory: string, streams = { stdout: process.stdout, stderr: process.stderr } as { stdout: Writable; stderr: Writable }) {
  const file = path.join(directory, "main.log");
  const previous = path.join(directory, "main.previous.log");
  let storageErrorReported = false;

  const persist = (level: string, message: string) => {
    try {
      mkdirSync(directory, { recursive: true });
      if (existsSync(file) && statSync(file).size >= MAX_LOG_BYTES) {
        if (existsSync(previous)) unlinkSync(previous);
        renameSync(file, previous);
      }
      // Use the camera diagnostic sanitizer for both transports. Sanitize the
      // entire record before truncating, so a clipped credential cannot leak.
      const safe = redactMlDiagnostic(message).slice(0, MAX_RECORD_CHARS).trimEnd();
      appendFileSync(file, `${new Date().toISOString()} [${level}] ${safe}\n`, { mode: 0o600 });
      storageErrorReported = false;
    } catch (error) {
      // A full/read-only disk must not take down the app either. Report through
      // the other available sink, without recursively trying the failed file.
      if (!storageErrorReported) {
        storageErrorReported = true;
        stderr.write(`[tanaw] Cannot write main-process log: ${redactMlDiagnostic(String(error))}\n`);
      }
    }
  };

  const guard = (name: "stdout" | "stderr") => {
    const stream = streams[name];
    let disconnected = false;
    const disconnect = (reason: string) => {
      if (disconnected) return;
      disconnected = true;
      persist("WARN", `${name} disconnected (${reason}); subsequent console output is retained in main.log.`);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        disconnect("EPIPE");
        return;
      }
      // This handler is deliberately limited to the two output streams and to
      // EPIPE. Network/ML failures and other stream errors retain normal error
      // reporting; there is no global uncaughtException suppression.
      persist("ERROR", `${name} transport error: ${error.stack ?? error.message}`);
      throw error;
    };
    stream.on("error", onError);
    return {
      write(message: string) {
        if (disconnected) return;
        if (stream.destroyed || stream.writableEnded) {
          disconnect("closed");
          return;
        }
        try {
          stream.write(message);
        } catch (error) {
          onError(error as NodeJS.ErrnoException);
        }
      },
      dispose: () => stream.off("error", onError),
    };
  };

  const stdout = guard("stdout");
  const stderr = guard("stderr");
  const transport = (name: "stdout" | "stderr") =>
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        const message = redactMlDiagnostic(chunk.toString("utf8"));
        // Persist first. Losing a terminal must never lose the original IPC or
        // application error that prompted the console write.
        try {
          persist(name === "stderr" ? "ERROR" : "INFO", message);
          (name === "stderr" ? stderr : stdout).write(message);
        } finally {
          // Complete our transport even when an unrelated terminal error is
          // rethrown. Otherwise Writable would buffer all later diagnostics.
          done();
        }
      },
    });
  const output = new Console({ stdout: transport("stdout"), stderr: transport("stderr"), colorMode: false, ignoreErrors: false });

  return {
    console: output,
    file,
    recordException(error: Error, origin: string) {
      persist("FATAL", `${origin}: ${formatWithOptions({ colors: false }, error)}`);
    },
    recordWarning(warning: Error) {
      persist("WARN", warning.stack ?? warning.message);
    },
    dispose() {
      stdout.dispose();
      stderr.dispose();
    },
  };
}
