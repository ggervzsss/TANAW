import { test } from "@playwright/test";
import { mockMlRequest, mlResponse } from "./support/preload";
import { themeServiceFixture, themeUser } from "../support/theme-fixture";
import { verifyThemeAndFilters } from "../support/theme-and-filters";

test("dark palette, immediate theme changes and automatic combined report filters", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date("2026-11-15T02:00:00Z") });
  await page.addInitScript(() => localStorage.setItem("tanaw-enterprise-theme", "light"));
  await page.route("**/auth/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    return route.fulfill({ json: endpoint.endsWith("/me") ? themeUser : endpoint.endsWith("system-settings") ? { values: {} } : { token: "theme-session", user: themeUser } });
  });
  await page.route("**/operational/**", (route) => route.fulfill({ json: [] }));
  await page.routeWebSocket("**/realtime/ws", (socket) =>
    socket.onMessage((message) => {
      if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
    }),
  );
  const respond = themeServiceFixture();
  await mockMlRequest(page, "*", (request) => {
    const response = respond(request);
    return mlResponse({ status: response.status, body: JSON.stringify(response.body) });
  });
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(themeUser.email);
  await page.getByPlaceholder("Enter your password").fill("Theme test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await verifyThemeAndFilters(page, info);
});
