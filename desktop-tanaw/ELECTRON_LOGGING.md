# Electron output and error logging

The recurring `EPIPE` exception came from the main process writing to an inherited
terminal pipe after its reader had closed. Both the development launcher
(`with-electron-env.cjs` → Vite → Electron) and `npm start` inherit their parent's
output. A terminal or captured command session can disappear while Electron is
still running. This is independent of renderer navigation and theme rendering.

Electron 42.5.1 logs rejected IPC handlers with `console.error` inside
`replyWithError`. With a closed stderr pipe, that logging operation itself can
raise the reported exception. The original IPC error is a separate diagnostic;
it must still be returned to the renderer and logged.

## Fix

`electron/main-logging-bootstrap.ts` is the first main entry import. It preserves
the existing profile path policy and installs a Node Console backed by two safe
transports before application startup modules run.

- Console messages are saved synchronously before terminal forwarding, including
  Error stacks and Electron's own IPC error messages.
- A synchronous or asynchronous `EPIPE` on **stdout or stderr only** retires that
  terminal transport for the remainder of the process. Other errors are still
  reported normally. There is no global handler that ignores EPIPE exceptions.
- RTSP credentials, passwords, bearer tokens and ML service tokens use the
  existing diagnostic redactor in both file and terminal output.
- Logs rotate at 1 MiB, retaining `main.previous.log`. Individual stored records
  are bounded. A file-storage failure is reported to the available terminal.
- `uncaughtExceptionMonitor` saves fatal diagnostics without replacing Electron's
  exception reporter or changing Node's unhandled-rejection policy.
- The existing ML child output pipes remain owned and drained by the supervisor;
  its console forwarding now uses the safe logger. Camera startup/shutdown and
  process ownership rules are unchanged.

## Log locations

Logs follow Electron's actual `userData` directory, including an explicit
`--user-data-dir` override:

- Development / `npm start`: `%APPDATA%\desktop-tanaw\logs\main.log`
- Packaged application: `%APPDATA%\TANAW Enterprise Desktop\logs\main.log`
- Existing ML diagnostics: `logs\ml-service.log` in the same profile.

The first record identifies the process, parent, Electron version and launch mode.
The final application record confirms that shutdown reached `will-quit` after
the existing service shutdown path.

## Regression verification

Before the fix, deliberately closing the launcher's stdout/stderr read ends and
then triggering console output and a rejected `ml-service:request` reproduced
the exact `Socket._write → console.error → replyWithError` EPIPE popup stack.

Run:

```powershell
npm run build
npm run type
npm run lint
npm test
npx playwright test --config=playwright.electron.config.ts main-logging.spec.ts
```

The Electron regression launches the actual desktop runtime with both the built
renderer and a Vite development renderer. Each mode is restarted three times in
an isolated profile. It disconnects both real output pipes, checks rejected IPC
replies and durable logs, navigates the three pages, switches themes, opens and
closes camera dialogs, and tests the camera connection through the real preload
and IPC bridge against a test-owned sidecar. It also deliberately raises an
unrelated uncaught exception to confirm that Electron's reporter still receives
it. Native error dialogs are intercepted only inside this regression test.

These tests use synthetic API/auth responses and a local sidecar fixture; they
do not establish a connection to physical camera hardware or a production API.
The built launch exercises the production main/renderer bundles, rather than a
signed installer distribution.

The normal `npm start` launcher was also checked with its output readers closed
and with all stdio ignored. Both runs retained the original IPC error in the log,
showed no native error dialogs, and exited with code 0 after service shutdown.
The existing `ELECTRON_RUN_AS_NODE` cleanup in the launcher was verified too.

Implementation references: [Electron 42.5.1 IPC dispatch](https://github.com/electron/electron/blob/v42.5.1/lib/browser/ipc-dispatch.ts#L86)
and [Node's non-consuming exception monitor](https://nodejs.org/docs/latest-v22.x/api/process.html#event-uncaughtexceptionmonitor).
