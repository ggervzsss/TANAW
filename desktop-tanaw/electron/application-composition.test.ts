import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("Electron application composition boundaries", () => {
  it("keeps main focused on composing lifecycle services", () => {
    const main = source("./main.ts");

    expect(main).toContain("createApplicationWindows");
    expect(main).toContain("createApplicationTray");
    expect(main).toContain("registerIpcHandlers");
    expect(main).not.toContain("new BrowserWindow");
    expect(main).not.toContain("new Tray");
  });

  it("retains renderer isolation and navigation restrictions in window ownership", () => {
    const windows = source("./application-windows.ts");

    expect(windows).toContain("contextIsolation: true");
    expect(windows).toContain("nodeIntegration: false");
    expect(windows).toContain("sandbox: true");
    expect(windows).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(windows).toContain('targetWebContents.on("will-navigate"');
  });

  it("keeps sidecar report events registered through validated IPC composition", () => {
    const main = source("./main.ts");

    expect(main).toContain("isMainRenderer: windows.isMainRenderer");
    expect(main).toContain("subscribeToReportEvents: subscribeToMlReportLiveEvents");
    expect(main).toContain("unsubscribeFromReportEvents: unsubscribeFromMlReportLiveEvents");
  });
});
