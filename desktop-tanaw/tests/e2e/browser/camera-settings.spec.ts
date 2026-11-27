// Camera Settings: tabs, drafts, area editing, Add Camera, counting methods, and unsaved changes.
import { expect, test } from "@playwright/test";
import { openSettings, polygon, settings, setup } from "./support/cameraSetup";

test.describe.configure({ timeout: 60_000 });

test("Camera Settings keeps its actions visible while the active tab scrolls", async ({ page }) => {
  await setup(page);
  await openSettings(page);
  const cameraSettings = settings(page);
  const cancel = cameraSettings.getByRole("button", { name: "Cancel", exact: true });
  const save = cameraSettings.getByRole("button", { name: "Save Changes", exact: true });
  const panel = cameraSettings.getByRole("tabpanel");

  await expect(page.getByRole("region", { name: "My Cameras" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toHaveCount(0);
  await expect(cameraSettings.getByRole("heading", { name: "Tapo Camera" })).toBeVisible();

  for (const size of [
    { width: 1920, height: 960 },
    { width: 800, height: 500 },
    { width: 640, height: 400 },
  ]) {
    await page.setViewportSize(size);
    const tabs = [
      ["Information", panel.getByRole("combobox", { name: "Camera Mode" })],
      ["Connection", panel.getByRole("button", { name: "Test Camera Connection" })],
      ["Counting Area", panel.getByRole("button", { name: "Edit Counting Area" })],
      ["Display", panel.getByRole("switch", { name: "Show Counting Area" })],
      ["Maintenance", panel.getByRole("button", { name: "Remove Camera" })],
    ] as const;
    for (const [name, lastControl] of tabs) {
      await cameraSettings.getByRole("tab", { name, exact: true }).click();
      await expect(cameraSettings).toBeInViewport({ ratio: 1 });
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await expect(save).toBeInViewport({ ratio: 1 });
      await panel.press("End");
      const scrollContainer = size.height <= 450 ? cameraSettings : panel;
      await expect.poll(() => scrollContainer.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
      if (name === "Maintenance" && size.height <= 500) {
        await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }
      await lastControl.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await expect(lastControl).toBeInViewport({ ratio: 1 });
      await expect
        .poll(async () => {
          const control = (await lastControl.boundingBox())!;
          const action = (await cancel.boundingBox())!;
          return control.y + control.height <= action.y;
        })
        .toBe(true);
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await expect(save).toBeInViewport({ ratio: 1 });
    }
  }

  await cancel.click();
  await expect(cameraSettings).toHaveCount(0);
  await expect(page.getByRole("region", { name: "My Cameras" }).getByRole("button", { name: /Tapo Camera/, pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
});

test("all settings tabs keep drafts, test real bridge requests and save only the selected camera", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1209 });
  await openSettings(page);
  await expect(settings(page).getByRole("tab")).toHaveCount(5);
  await page.screenshot({ path: info.outputPath("camera-information.png"), fullPage: true });
  await page.getByRole("textbox", { name: "Camera Name", exact: true }).fill("Updated Tapo");
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page.getByLabel("Camera Username", { exact: true }).fill("draft-user");
  await page.getByLabel("Camera Password", { exact: true }).fill("draft-secret");
  // While the connection is tested, its fields hold their values.
  let releaseSettingsTest = () => {};
  state.holdTest(new Promise<void>((resolve) => (releaseSettingsTest = resolve)));
  await page.getByRole("button", { name: "Test Camera Connection", exact: true }).click();
  await expect(page.getByRole("button", { name: "Testing connection…", exact: true })).toBeDisabled();
  for (const label of ["Camera IP Address", "Camera Username", "Camera Password"]) await expect(page.getByLabel(label, { exact: true })).not.toBeEditable();
  state.holdTest(null);
  releaseSettingsTest();
  await expect(page.getByText("Camera connection verified with these settings.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Camera Username", { exact: true })).toBeEditable();
  expect(state.requests.find((value) => value.path === "/camera/test")!.body).toMatchObject({ camera_id: 1, username: "draft-user", password: "draft-secret" });
  expect(state.profiles()[0].name).toBe("Tapo Camera");
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await page.getByRole("switch", { name: "Show Detected People", exact: true }).click();
  await page.getByRole("tab", { name: "Information", exact: true }).click();
  await expect(page.getByLabel("Camera Name", { exact: true })).toHaveValue("Updated Tapo");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0]).toMatchObject({ name: "Updated Tapo" });
  expect(state.profiles()[0]).not.toHaveProperty("autoReconnect");
  expect(state.profiles()[1].name).toBe("Dahua Camera");
  expect(state.profiles()[0]).not.toHaveProperty("password");
  await openSettings(page);
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Show Detected People", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("region", { name: "My Cameras" })
    .getByRole("button", { name: /Dahua Camera/ })
    .click();
  await openSettings(page);
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Show Detected People", exact: true })).toBeChecked();
});

test("area dragging, Undo, validation, cancel and resize preserve the saved polygon", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1209 });
  await openSettings(page);
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Counting Area", exact: true });
  const svg = dialog.getByRole("group", { name: "Monitored area polygon" });
  await expect(svg).toBeVisible();
  const point = svg.getByRole("button", { name: "Zone vertex 1" });
  const bounds = (await svg.boundingBox())!;
  await point.hover();
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.3, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => Number(await point.getAttribute("cx"))).toBeCloseTo(25, 0);
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(point).toHaveAttribute("cx", "15");
  await point.focus();
  await point.press("ArrowRight");
  await dialog.getByRole("button", { name: "Use this Area", exact: true }).click();
  expect(state.profiles()[0].openSpace!.polygon[0].x).toBe(0.15);
  await page.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
  await expect(point).toHaveAttribute("cx", "15.5");
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(point).toHaveAttribute("cx", "15.5");
  await page.screenshot({ path: info.outputPath("counting-area-1024.png"), fullPage: true });
  await point.hover();
  await page.mouse.down();
  const resized = (await svg.boundingBox())!;
  await page.mouse.move(resized.x + resized.width * 0.5, resized.y + resized.height * 0.95, { steps: 10 });
  await page.mouse.up();
  await expect(dialog.getByRole("button", { name: "Use this Area", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Close Edit Counting Area", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard Changes", exact: true }).click();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0].openSpace!.polygon[0].x).toBe(0.155);
  expect(state.profiles()[1].openSpace!.polygon[0].x).toBe(0.15);
});

test("dropdowns and unsaved dialogs dismiss predictably, and maintenance uses real responses", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSettings(page);
  await page.getByRole("combobox", { name: "Camera brand / type" }).click();
  await page.getByRole("combobox", { name: "Camera Mode" }).click();
  await expect(page.getByRole("listbox")).toHaveCount(1);
  await expect(page.getByRole("listbox", { name: "Camera Mode" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
  await page.getByLabel("Camera Name", { exact: true }).fill("Draft");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Keep Editing" }).click();
  await page.getByRole("tab", { name: "Maintenance", exact: true }).click();
  await page.getByRole("button", { name: "Run Diagnostics", exact: true }).click();
  await expect(page.getByRole("list", { name: "Camera diagnostics" })).toContainText("Raw frame age: 50 ms");
  await page.getByRole("button", { name: "Restore Camera Defaults", exact: true }).click();
  await page.getByRole("dialog", { name: "Restore Camera Defaults", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.profiles()[0].openSpace).not.toBeNull();
  await page.screenshot({ path: info.outputPath("camera-maintenance.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove Camera", exact: true }).click();
  const remove = page.getByRole("dialog", { name: "Remove Camera", exact: true });
  await remove.getByRole("button", { name: "Keep Camera", exact: true }).click();
  expect(state.profiles()).toHaveLength(2);
  await page.getByRole("button", { name: "Reconnect Camera", exact: true }).click();
  await expect.poll(() => state.requests.filter((request) => request.path === "/camera/start").length).toBe(1);
  await page.getByRole("button", { name: "Remove Camera", exact: true }).click();
  await remove.getByRole("button", { name: "Remove Camera", exact: true }).click();
  await expect.poll(() => state.profiles().length).toBe(1);
  expect(state.profiles()[0].id).toBe(2);
});

test("Add Camera keeps the reference form and verifies connection before persisting", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Camera Information", exact: true });
  await modal.getByRole("button", { name: "Add Camera", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Camera name");
  await modal.getByLabel("Camera Name", { exact: false }).fill("Gate Camera");
  await modal.getByRole("combobox", { name: "Camera Mode" }).click();
  await page.getByRole("option", { name: "Open Space", exact: true }).click();
  await page.screenshot({ path: info.outputPath("add-camera-information.png"), fullPage: true });
  await modal.getByRole("button", { name: "Add Camera", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "Camera Connection", exact: true });
  const ip = connection.getByLabel("Camera IP Address");
  const defaultDark = await page.locator("html").evaluate((element) => element.classList.contains("dark"));
  for (const dark of [false, true]) {
    await page.locator("html").evaluate((element, dark) => element.classList.toggle("dark", dark), dark);
    await page.keyboard.press("Tab");
    for (const label of ["Camera IP Address", "Camera Username", "Camera Password"]) {
      const field = connection.getByLabel(label, { exact: false }).first();
      await field.focus();
      await expect(field).toHaveCSS("outline-width", "2px");
      await expect(field).toHaveCSS("outline-style", "solid");
      await expect(field).toHaveCSS("outline-offset", "-2px");
    }
  }
  await page.locator("html").evaluate((element, dark) => element.classList.toggle("dark", dark), defaultDark);
  await ip.fill("192.168.1.11");
  await expect(connection.getByText("A camera with this IP address is already configured", { exact: false })).toBeVisible();
  await expect(connection.getByRole("button", { name: "Test & Add Camera" })).toBeDisabled();
  await connection.getByLabel("Camera IP Address").fill("192.168.1.30");
  await connection.getByLabel("Camera Username", { exact: false }).fill("operator");
  await connection.getByLabel("Camera Password", { exact: false }).fill("camera-secret");
  state.setFailTest(true);
  await connection.getByRole("button", { name: "Test & Add Camera" }).click();
  await expect(connection.getByText("Camera unreachable")).toBeVisible();
  expect(state.profiles()).toHaveLength(2);
  state.setFailTest(false);
  state.setFailWrite(true);
  await connection.getByRole("button", { name: "Test & Add Camera" }).click();
  await expect(connection.getByText("Camera storage unavailable")).toBeVisible();
  expect(state.profiles()).toHaveLength(2);
  state.setFailWrite(false);
  // While the camera is tested and added, the connection fields cannot change.
  let releaseAddTest = () => {};
  state.holdTest(new Promise<void>((resolve) => (releaseAddTest = resolve)));
  await connection.getByRole("button", { name: "Test & Add Camera" }).click();
  await expect(connection.getByRole("button", { name: "Testing Camera…" })).toBeDisabled();
  for (const label of ["Camera IP Address", "Camera Username", "Camera Password"]) await expect(connection.getByLabel(label, { exact: false })).not.toBeEditable();
  state.holdTest(null);
  releaseAddTest();
  await expect(connection).toHaveCount(0);
  await expect.poll(() => state.profiles().length).toBe(3);
  expect(state.profiles()[2]).toMatchObject({ name: "Gate Camera", zone: "", analysisMode: "open_space" });
  expect(JSON.stringify(state.profiles())).not.toContain("camera-secret");
});

test("Add Camera text and actions fit in a compact window in both themes", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 800, height: 500 });
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Camera Information" });
  const input = modal.getByLabel("Camera Name");
  const mode = modal.getByRole("combobox", { name: "Camera Mode" });
  const label = modal.locator("label[for='camera-name']");
  const hint = modal.getByText("Example: Main Gate, Lobby, or Park");
  for (const dark of [false, true]) {
    await page.locator("html").evaluate((element, dark) => element.classList.toggle("dark", dark), dark);
    await expect(label).toHaveCSS("font-size", "15px");
    await expect(input).toHaveCSS("font-size", "16px");
    await expect(mode).toHaveCSS("font-size", "16px");
    await expect(hint).toHaveCSS("font-size", "14px");
    await mode.click();
    await expect(page.getByRole("option", { name: "Open Space", exact: true })).toHaveCSS("font-size", "16px");
    await mode.press("Escape");
    await expect(modal.getByRole("button", { name: "Cancel" })).toBeInViewport({ ratio: 1 });
    await expect(modal.getByRole("button", { name: "Add Camera" })).toBeInViewport({ ratio: 1 });
  }
  await input.fill("Gate Camera");
  await modal.getByRole("button", { name: "Add Camera" }).click();
  const connection = page.getByRole("dialog", { name: "Camera Connection" });
  await expect(connection.getByLabel("Camera IP Address")).toHaveCSS("font-size", "16px");
  await expect(connection.getByRole("button", { name: "Test & Add Camera" })).toBeInViewport({ ratio: 1 });
});

test("switching counting methods preserves calibration and stages counting until Save", async ({ page }) => {
  const state = await setup(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("radio", { name: /Entry \/ Exit/ }).check();
  await page.getByRole("radio", { name: /Open Space/ }).check();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0].openSpace!.polygon).toEqual(polygon);
  expect(state.requests.filter((value) => value.path === "/camera/start")).toHaveLength(0);
  await openSettings(page);
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("radio", { name: /Entry \/ Exit/ }).check();
  await page.getByRole("switch", { name: "Enable Visitor Counting", exact: true }).click();
  expect(state.requests.filter((value) => value.path.endsWith("/stop"))).toHaveLength(0);
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0].analysisMode).toBe("entrance_exit");
  expect(state.profiles()[1].analysisMode).toBe("open_space");
  expect(state.requests.find((value) => value.path.endsWith("/stop"))!.path).toBe("/camera/1/stop");
});

test("unsaved navigation can be cancelled without retaining a stale navigation action", async ({ page }) => {
  const state = await setup(page);
  await openSettings(page);
  await page.getByLabel("Camera Name", { exact: true }).fill("Unsaved camera");
  await page.locator('[data-topbar-navigation="dashboard"]').click();
  const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(/enterprise\/cameras/);
  await confirm.getByRole("button", { name: "Keep Editing" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirm.getByRole("button", { name: "Discard Changes" }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/enterprise\/cameras/);
  expect(state.profiles()[0].name).toBe("Tapo Camera");
  await openSettings(page);
  await page.getByLabel("Camera Name", { exact: true }).fill("Another draft");
  await page.locator('[data-topbar-navigation="reports"]').click();
  await confirm.getByRole("button", { name: "Discard Changes" }).click();
  await expect(page).toHaveURL(/enterprise\/reports/);
  expect(state.profiles()[0].name).toBe("Tapo Camera");
});
