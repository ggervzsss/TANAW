import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeMlSidecar } from "./support/fake-ml-sidecar";
import { themeServiceFixture, themeUser } from "../support/theme-fixture";

type TestMainState = typeof globalThis & { stdioDialogs: string[] };

for (const mode of ["built", "development"] as const) {
  test(`${mode}: closed launch pipes preserve IPC, UI, logging and normal exception reporting across restarts`, async ({ playwright }, info) => {
    test.setTimeout(150_000);
    const directory = await mkdtemp(path.join(tmpdir(), "tanaw-main-logging-"));
    const profile = path.join(directory, "profile");
    const logFile = path.join(profile, "logs", "main.log");
    const sidecar = new FakeMlSidecar(),
      respond = themeServiceFixture();
    sidecar.respond = async (request) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      if (request.url === "/camera/test") return { status: 200, body: { ok: true } };
      return respond({ url: request.url ?? "/", method: request.method, body: body || undefined });
    };
    let app: ElectronApplication | undefined;
    let server: ChildProcess | undefined;
    try {
      await sidecar.start();
      let devUrl: string | undefined;
      if (mode === "development") {
        // Use the project's real Vite configuration, but let Playwright own the
        // Electron process so it can deliberately close the launch output pipes.
        const port = await availablePort();
        devUrl = `http://127.0.0.1:${port}/`;
        server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
          env: { ...process.env, TANAW_RENDERER_ONLY: "true", VITE_API_BASE_URL: "http://localhost:8000" },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        server.stdout!.on("data", (chunk) => {
          output = (output + chunk.toString()).slice(-8192);
        });
        server.stderr!.on("data", (chunk) => {
          output = (output + chunk.toString()).slice(-8192);
        });
        await expect
          .poll(
            async () => {
              if (server!.exitCode !== null) throw new Error(`Development server exited: ${output}`);
              return fetch(devUrl!)
                .then((response) => response.ok)
                .catch(() => false);
            },
            { timeout: 30_000 },
          )
          .toBe(true);
      }
      const env: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[0] !== "VITE_DEV_SERVER_URL"),
      );
      Object.assign(env, { APPDATA: directory, LOCALAPPDATA: directory, TANAW_ML_SERVICE_PORT: String(sidecar.port) });
      if (devUrl) env.VITE_DEV_SERVER_URL = devUrl;
      for (let attempt = 0; attempt < 3; attempt++) {
        app = await playwright._electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
        await app.evaluate(({ dialog }) => {
          const state = globalThis as TestMainState;
          state.stdioDialogs = [];
          // Test-only interception prevents a blocking native dialog while
          // proving that Electron's actual exception reporter remains active.
          dialog.showErrorBox = (title, content) => state.stdioDialogs.push(`${title}: ${content}`);
        });
        const context = app.context();
        const headers = {
          "access-control-allow-origin": devUrl ? new URL(devUrl).origin : "tanaw-app://desktop",
          "access-control-allow-credentials": "true",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "Content-Type,Authorization",
        };
        await context.routeWebSocket("**/realtime/ws", (socket) =>
          socket.onMessage((message) => {
            if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
          }),
        );
        const rendererOrigin = devUrl ?? "tanaw-app://desktop/";
        await expect.poll(() => app!.windows().some((page) => page.url().startsWith(rendererOrigin))).toBe(true);
        const page = app.windows().find((page) => page.url().startsWith(rendererOrigin))!;
        const cdp = await context.newCDPSession(page);
        cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
          const endpoint = new URL(request.url).pathname;
          const json = endpoint.endsWith("/me")
            ? themeUser
            : endpoint.endsWith("system-settings")
              ? { values: {} }
              : endpoint.startsWith("/auth/")
                ? { token: "logging-test-session", user: themeUser }
                : [];
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: Object.entries({ ...headers, "Content-Type": "application/json" }).map(([name, value]) => ({ name, value })),
            body: Buffer.from(JSON.stringify(json)).toString("base64"),
          });
        });
        await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:8000/*" }] });
        await page.goto(`${devUrl ?? "tanaw-app://desktop/index.html"}#/login`);
        await page.getByPlaceholder("Enter username or registered email").fill(themeUser.email);
        await page.getByPlaceholder("Enter your password").fill("Logging test password");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page.locator(".overview-layout")).toBeVisible();
        await app.evaluate(
          ({ BrowserWindow }, origin) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.webContents.getURL().startsWith(origin))
              ?.show(),
          rendererOrigin,
        );
        await expect(await rejectedIpc(page)).toContain("Invalid URL");

        // This reproduced the user's exact console.error -> replyWithError
        // EPIPE stack before the fix. Both streams are disconnected for real.
        app.process().stdout?.destroy();
        app.process().stderr?.destroy();
        await app.evaluate(async () => {
          for (let index = 0; index < 10; index++) {
            console.info("stdout closed-terminal probe %d", index);
            console.error("stderr closed-terminal probe %d", index);
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          process.emitWarning("Synthetic warning after terminal closure");
          await new Promise((resolve) => setImmediate(resolve));
        });
        await expect(await rejectedIpc(page)).toContain("Invalid URL");
        await exerciseUi(page);
        expect(await app.evaluate(() => (globalThis as TestMainState).stdioDialogs)).toEqual([]);
        expect(app.process().exitCode).toBeNull();
        const saved = await readFile(logFile, "utf8");
        expect(saved).toContain("stdout disconnected (EPIPE)");
        expect(saved).toContain("stderr disconnected (EPIPE)");
        expect(saved).toContain("Error occurred in handler for 'ml-service:request'");
        expect(saved).toContain("TypeError: Invalid URL");
        expect(saved).toContain("stderr closed-terminal probe 9");
        expect(saved).toContain("[WARN] Warning: Synthetic warning after terminal closure");
        expect(saved).not.toContain("synthetic-camera-password");

        // A genuine uncaught error must still reach Electron's native reporter,
        // as well as the durable log. No blanket exception suppression is used.
        if (attempt === 2) {
          await app.evaluate(() =>
            setImmediate(() => {
              throw new Error("Synthetic unrelated main exception for reporter verification");
            }),
          );
          await expect.poll(() => app!.evaluate(() => (globalThis as TestMainState).stdioDialogs.length)).toBe(1);
          expect((await app.evaluate(() => (globalThis as TestMainState).stdioDialogs))[0]).toContain("Synthetic unrelated main exception");
          expect(await readFile(logFile, "utf8")).toContain("[FATAL] uncaughtException: Error: Synthetic unrelated main exception");
        }
        const electronProcess = app.process();
        await app.close();
        expect(electronProcess.exitCode).toBe(0);
        app = undefined;
      }
      const saved = await readFile(logFile, "utf8");
      expect(saved.match(/Main process started:/g)).toHaveLength(3);
      expect(saved.match(/Main process quitting after service shutdown/g)).toHaveLength(3);
      await info.attach("main-process-log", { body: saved, contentType: "text/plain" });
    } finally {
      await app?.close();
      if (server && server.exitCode === null) {
        const closed = once(server, "exit");
        server.kill();
        await closed;
      }
      await sidecar.stop();
      await cleanup(directory);
    }
  });
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate development server port");
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function cleanup(directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("tanaw-main-logging-")) throw new Error("Unexpected logging test cleanup directory");
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function rejectedIpc(page: Page) {
  return page.evaluate(async () =>
    Promise.race([
      window.tanawMlService!.request({ method: "GET", url: "invalid-url", timeoutMs: 1000 }).catch((error: Error) => error.message),
      new Promise<string>((resolve) => setTimeout(() => resolve("IPC reply timed out"), 1500)),
    ]),
  );
}

async function exerciseUi(page: Page) {
  for (const destination of ["Reports", "Camera Setup", "Dashboard", "Camera Setup"]) {
    await page.getByRole("button", { name: destination, exact: true }).click();
    await page.getByRole("button", { name: "Open account menu" }).click();
    await page.getByRole("button", { name: "General Settings" }).click();
    await page.getByRole("button", { name: "Appearance" }).click();
    const dark = await page.getByRole("radio", { name: "Dark Mode" }).getAttribute("aria-checked") === "true";
    const target = page.getByRole("radio", { name: dark ? "Light Mode" : "Dark Mode" });
    await target.click();
    await expect(target).toBeChecked();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
    await page.getByRole("button", { name: "Back from General Settings" }).click();
  }
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Camera Information", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Camera Information", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit configuration" }).click();
  const settings = page.getByRole("region", { name: "Camera Settings", exact: true });
  for (const section of ["Information", "Connection", "Counting Area", "Display", "Maintenance"]) await settings.getByRole("tab", { name: section, exact: true }).click();
  await settings.getByRole("tab", { name: "Connection", exact: true }).click();
  await settings.getByLabel("Camera Username", { exact: true }).fill("test-camera-user");
  await settings.getByLabel("Camera Password", { exact: true }).fill("synthetic-camera-password");
  await settings.getByRole("button", { name: "Test Camera Connection", exact: true }).click();
  await expect(page.getByText("Camera connection verified with these settings.", { exact: false })).toBeVisible();
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard Changes" }).click();
  await expect(settings).toHaveCount(0);
}
