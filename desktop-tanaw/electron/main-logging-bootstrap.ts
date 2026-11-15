import { app } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createMainProcessLogging } from "./main-logging";

// Keep the existing packaged profile policy, before resolving the log path.
// This module is the first main entry import, so other startup modules and IPC
// handlers never depend on the launcher's terminal for error reporting.
if (app.isPackaged && !app.commandLine.hasSwitch("user-data-dir")) {
  const profile = path.join(app.getPath("appData"), "TANAW Enterprise Desktop");
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
}

const logging = createMainProcessLogging(path.join(app.getPath("userData"), "logs"));
globalThis.console = logging.console;

// Observe fatal errors without consuming them. Electron's default exception
// dialogs/reporting and Node's rejection behavior are intentionally preserved.
process.on("uncaughtExceptionMonitor", logging.recordException);
process.on("warning", logging.recordWarning);
console.info(
  `[tanaw] Main process started: pid=${process.pid} parent=${process.ppid} electron=${process.versions.electron} packaged=${app.isPackaged} mode=${process.env.VITE_DEV_SERVER_URL ? "development" : "built"}`,
);
app.on("will-quit", () => console.info("[tanaw] Main process quitting after service shutdown."));
