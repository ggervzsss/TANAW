import { expect, test, type Page } from "@playwright/test";
import type { components } from "../../src/contracts/generated/api";
import { json, mockEmptyCollections, mockPortalSession, portalUser, type PortalTheme } from "./support/session";

type Account = components["schemas"]["AccountSummary"];
type ChangeRequest = components["schemas"]["AccountProfileChangeRequest"];

const viewer = portalUser("it", { id: "it-e2e", displayName: "Ana Reyes", firstName: "Ana", lastName: "Reyes" });

function account(id: string, overrides: Partial<Account>): Account {
  return {
    id,
    email: `${id}@lgu.example.test`,
    phone: null,
    firstName: "Test",
    lastName: id,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId: null,
    gatewayStatus: null,
    buildingCapacity: 0,
    displayName: `Test ${id}`,
    role: "staff",
    title: "LGU Staff",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2026-10-01T00:00:00Z",
    lastLoginAt: null,
    invitation: null,
    deactivatedAt: null,
    deactivatedByName: null,
    ...overrides,
  };
}

function emailChange(overrides: Partial<ChangeRequest>): ChangeRequest {
  return {
    type: "businessEmail",
    label: "Business email",
    requestedValue: "new@lgu.example.test",
    requestedAt: "2026-11-24T02:00:00Z",
    requestId: "change-1",
    status: "verified",
    isVerified: true,
    canApprove: true,
    expiresAt: null,
    requestedByName: null,
    requestedByAccountId: null,
    ...overrides,
  };
}

function seedAccounts(): Account[] {
  return [
    account("it-e2e", {
      displayName: "Ana Reyes",
      firstName: "Ana",
      lastName: "Reyes",
      email: "ana.reyes@lgu.example.test",
      role: "it",
      title: "IT Personnel",
      isProtectedDefault: true,
      lastLoginAt: "2026-11-26T01:00:00Z",
    }),
    account("carlo", {
      displayName: "Carlo Mendoza",
      firstName: "Carlo",
      lastName: "Mendoza",
      email: "c.mendoza@lgu.example.test",
      role: "it",
      title: "IT Personnel",
      lastLoginAt: "2026-11-25T07:38:00Z",
      profileChangeRequests: [emailChange({ requestedValue: "carlo.mendoza@lgu.example.test", requestedByAccountId: "carlo", requestedByName: "Carlo Mendoza" })],
    }),
    account("admin", {
      displayName: "Lea Admin",
      firstName: "Lea",
      lastName: "Admin",
      email: "lea.admin@lgu.example.test",
      role: "admin",
      title: "Admin",
      profileChangeRequests: [emailChange({ requestedValue: "lea@lgu.example.test", canApprove: false, requestedByAccountId: "it-e2e", requestedByName: "Ana Reyes" })],
    }),
    account("mark", { displayName: "Mark Dela Cruz", firstName: "Mark", lastName: "Dela Cruz", email: "mark.delacruz@lgu.example.test", role: "staff", lastLoginAt: "2026-11-24T08:47:00Z" }),
    account("grace", {
      displayName: "Grace Bautista",
      firstName: "Grace",
      lastName: "Bautista",
      email: "grace.bautista@lgu.example.test",
      isActivated: false,
      invitation: { sentAt: "2026-11-22T02:00:00Z", expiresAt: "2026-11-23T02:00:00Z", expired: true },
    }),
    account("paolo", {
      displayName: "Paolo Santos",
      firstName: "Paolo",
      lastName: "Santos",
      email: "paolo.santos@lgu.example.test",
      status: "inactive",
      lastLoginAt: "2026-10-30T02:00:00Z",
      deactivatedAt: "2026-10-31T03:00:00Z",
      deactivatedByName: "Carlo Mendoza",
    }),
  ];
}

type Calls = { method: string; url: string; body: unknown }[];

async function openPersonnel(page: Page, options: { theme?: PortalTheme; viewer?: typeof viewer } = {}) {
  const accounts = seedAccounts();
  const calls: Calls = [];
  const record = (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const request = route.request();
    calls.push({ method: request.method(), url: request.url(), body: request.postDataJSON() as unknown });
  };
  const find = (url: string) => accounts.find((item) => url.includes(`/accounts/${item.id}/`) || url.endsWith(`/accounts/lgu/${item.id}`));

  const signedIn = options.viewer ?? viewer;
  await mockPortalSession(page, signedIn, { theme: options.theme ?? "light" });
  await mockEmptyCollections(page, ["**/operational/notifications", "**/operational/alerts", "**/operational/requests", "**/activity-logs", "**/mail/deliveries*", "**/dev/deliveries*"]);
  await page.route("**/auth/system-settings", (route) => route.fulfill(json({ values: { "display.dateFormat": "MMM d, yyyy", "display.timeFormat": "12-hour" } })));
  await page.route("**/accounts/lgu", async (route) => {
    if (route.request().method() === "POST") {
      record(route);
      const body = route.request().postDataJSON() as { firstName: string; lastName: string; email: string; role: string };
      const created = account("new-person", {
        ...body,
        displayName: `${body.firstName} ${body.lastName}`,
        isActivated: false,
        invitation: { sentAt: "2026-11-26T02:00:00Z", expiresAt: "2026-11-27T02:00:00Z", expired: false },
      });
      accounts.push(created);
      return route.fulfill(json(created, 201));
    }
    return route.fulfill(json(accounts));
  });
  await page.route("**/accounts/lgu/*", (route) => {
    record(route);
    const target = find(route.request().url());
    if (!target) return route.fulfill(json({ detail: "Not found" }, 404));
    const body = route.request().postDataJSON() as { firstName: string; lastName: string; role: string };
    Object.assign(target, { firstName: body.firstName, lastName: body.lastName, role: body.role, displayName: `${body.firstName} ${body.lastName}` });
    return route.fulfill(json(target));
  });
  await page.route("**/accounts/*/status", (route) => {
    record(route);
    const target = find(route.request().url());
    if (!target) return route.fulfill(json({ detail: "Not found" }, 404));
    const { status } = route.request().postDataJSON() as { status: "active" | "inactive" };
    Object.assign(
      target,
      status === "inactive" ? { status, deactivatedAt: "2026-11-26T03:00:00Z", deactivatedByName: signedIn.displayName } : { status, deactivatedAt: null, deactivatedByName: null },
    );
    return route.fulfill(json(target));
  });
  await page.route("**/accounts/*/activation", (route) => {
    record(route);
    const target = find(route.request().url());
    if (!target) return route.fulfill(json({ detail: "Not found" }, 404));
    target.invitation = { sentAt: "2026-11-26T02:00:00Z", expiresAt: "2026-11-27T02:00:00Z", expired: false };
    return route.fulfill(json(target));
  });
  await page.route("**/accounts/*/email-change-request", (route) => {
    record(route);
    const target = find(route.request().url());
    if (!target) return route.fulfill(json({ detail: "Not found" }, 404));
    const { action } = route.request().postDataJSON() as { action: "approve" | "decline" };
    const request = target.profileChangeRequests?.find((item) => item.type === "businessEmail");
    if (action === "approve" && request) target.email = request.requestedValue;
    target.profileChangeRequests = [];
    return route.fulfill(json(target));
  });

  await page.goto("/it/personnel");
  await expect(page.getByRole("heading", { level: 1, name: "LGU Personnel" })).toBeVisible();
  return { accounts, calls };
}

const table = (page: Page) => page.getByRole("table");
const row = (page: Page, name: string) =>
  table(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: new RegExp(name) }) });

test.describe("IT LGU Personnel", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("lists people with their tags, access, last sign-in and lock notes", async ({ page }) => {
    await openPersonnel(page);

    await expect(row(page, "Ana Reyes")).toContainText("You · First IT account");
    await expect(row(page, "Ana Reyes")).toContainText("Protected");
    await expect(row(page, "Ana Reyes").getByRole("button", { name: /Edit|Deactivate/ })).toHaveCount(0);

    await expect(row(page, "Carlo Mendoza")).toContainText("Active");
    await expect(row(page, "Carlo Mendoza")).toContainText("Can sign in");
    await expect(row(page, "Carlo Mendoza")).toContainText("Nov 25, 2026, 3:38 PM");
    await expect(row(page, "Carlo Mendoza").getByRole("button", { name: "Deactivate Carlo Mendoza" })).toBeVisible();

    await expect(row(page, "Lea Admin")).toContainText("Last active Admin account");
    await expect(row(page, "Mark Dela Cruz").getByRole("button", { name: "Deactivate Mark Dela Cruz" })).toBeVisible();

    await expect(row(page, "Grace Bautista")).toContainText("Invitation sent");
    await expect(row(page, "Grace Bautista")).toContainText("Invitation expired");
    await expect(row(page, "Grace Bautista")).toContainText("Never");
    await expect(row(page, "Grace Bautista").getByRole("button", { name: /Send a new link/ })).toBeVisible();

    await expect(row(page, "Paolo Santos")).toHaveCount(0);
    const roles = page.getByRole("radiogroup", { name: "Role" });
    await expect(roles.getByRole("radio", { name: /All/ })).toContainText("5");
    await expect(roles.getByRole("radio", { name: /Staff/ })).toContainText("2");

    await page.getByRole("checkbox", { name: "Show deactivated accounts" }).check();
    await expect(roles.getByRole("radio", { name: /All/ })).toContainText("6");
    await expect(row(page, "Paolo Santos")).toContainText("Turned off Oct 31, 2026 by Carlo Mendoza");
    await expect(row(page, "Paolo Santos").getByRole("button", { name: "Activate Paolo Santos" })).toBeVisible();

    await roles.getByRole("radio", { name: /IT/ }).click();
    await expect(table(page).getByRole("rowheader")).toHaveCount(2);
    await roles.getByRole("radio", { name: /All/ }).click();
    await page.getByRole("searchbox", { name: "Search" }).fill("dela cruz");
    await expect(table(page).getByRole("rowheader")).toHaveCount(1);
    await expect(row(page, "Mark Dela Cruz")).toBeVisible();
  });

  test("approves or declines a sign-in email change", async ({ page }) => {
    const { calls } = await openPersonnel(page);

    const carlo = page.getByRole("region", { name: "Carlo Mendoza asked to change the sign-in email" });
    await expect(carlo).toContainText("From c.mendoza@lgu.example.test to carlo.mendoza@lgu.example.test. The new address is verified.");
    const lea = page.getByRole("region", { name: "Ana Reyes asked to change Lea Admin's sign-in email" });
    await expect(lea).toContainText("Another IT account has to approve it.");
    await expect(lea.getByRole("button", { name: /Approve/ })).toHaveCount(0);

    await carlo.getByRole("button", { name: /Approve/ }).click();
    await expect(page.getByText("Email change approved")).toBeVisible();
    await expect(carlo).toHaveCount(0);
    await expect(row(page, "Carlo Mendoza")).toContainText("carlo.mendoza@lgu.example.test");
    expect(calls.find((call) => call.url.endsWith("/accounts/carlo/email-change-request"))?.body).toEqual({ action: "approve" });

    await lea.getByRole("button", { name: /Decline/ }).click();
    await expect(page.getByText("Email change declined")).toBeVisible();
    await expect(lea).toHaveCount(0);
  });

  test("invites personnel from the Invite personnel dialog", async ({ page }) => {
    const { calls } = await openPersonnel(page);

    await page.getByRole("button", { name: "Invite personnel" }).click();
    const sheet = page.getByRole("dialog", { name: "Invite personnel" });
    await expect(sheet.getByRole("textbox", { name: "First name" })).toBeFocused();
    await sheet.getByRole("button", { name: "Send invitation" }).click();
    await expect(sheet.getByText("First name is required.")).toBeVisible();
    await expect(sheet.getByRole("textbox", { name: "First name" })).toBeFocused();

    await sheet.getByRole("textbox", { name: "First name" }).fill("Rosa");
    await sheet.getByRole("textbox", { name: /Middle initial/ }).fill("m");
    await sheet.getByRole("textbox", { name: "Last name" }).fill("Villanueva");
    await sheet.getByRole("textbox", { name: "Work email" }).fill("Rosa.Villanueva@lgu.example.test");
    await sheet.getByRole("textbox", { name: /Phone/ }).fill("9171234567");
    await sheet.getByRole("radio", { name: /^IT/ }).check();
    await sheet.getByRole("button", { name: "Send invitation" }).click();

    await expect(sheet).toBeHidden();
    await expect(page.getByText("Rosa M Villanueva will get a link at rosa.villanueva@lgu.example.test.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/accounts/lgu"))?.body).toEqual({
      firstName: "Rosa",
      lastName: "M Villanueva",
      email: "rosa.villanueva@lgu.example.test",
      phone: "+639171234567",
      role: "it",
    });
    await expect(row(page, "Rosa M Villanueva")).toContainText("Send invitation again");
  });

  test("edits a person after reviewing the changes", async ({ page }) => {
    const { calls } = await openPersonnel(page);

    await row(page, "Mark Dela Cruz").getByRole("button", { name: "Edit Mark Dela Cruz" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit Mark Dela Cruz" });
    await expect(sheet.getByText(/sends a verification link to the new address/)).toBeVisible();
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet.getByText("Nothing has changed yet.")).toBeVisible();

    await sheet.getByRole("radio", { name: /^Admin/ }).check();
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet.getByText("Save these changes?")).toBeVisible();
    await expect(sheet).toContainText("Role: Staff");
    await sheet.getByRole("button", { name: "Confirm and save" }).click();

    await expect(sheet).toBeHidden();
    await expect(page.getByText("Mark Dela Cruz is now Admin.")).toBeVisible();
    expect(calls.find((call) => call.method === "PATCH" && call.url.endsWith("/accounts/lgu/mark"))?.body).toMatchObject({ role: "admin", email: "mark.delacruz@lgu.example.test" });
  });

  test("locks your own IT role in the edit sheet and closes on Escape", async ({ page }) => {
    await openPersonnel(page, { viewer: portalUser("it", { id: "carlo", displayName: "Carlo Mendoza", firstName: "Carlo", lastName: "Mendoza" }) });
    await expect(row(page, "Carlo Mendoza")).toContainText("You");
    await expect(row(page, "Carlo Mendoza").getByRole("button", { name: "Deactivate Carlo Mendoza" })).toHaveCount(0);
    await expect(row(page, "Ana Reyes")).toContainText("First IT account");
    await row(page, "Carlo Mendoza").getByRole("button", { name: "Edit Carlo Mendoza" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit Carlo Mendoza" });
    await expect(sheet.getByText("You cannot remove your own IT access.")).toBeVisible();
    await expect(sheet.getByRole("radio", { name: /^Staff/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(row(page, "Carlo Mendoza").getByRole("button", { name: "Edit Carlo Mendoza" })).toBeFocused();
  });

  test("deactivates after confirming, then activates again", async ({ page }) => {
    const { calls } = await openPersonnel(page);

    await row(page, "Mark Dela Cruz").getByRole("button", { name: "Deactivate Mark Dela Cruz" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Deactivate Mark Dela Cruz?" });
    await expect(confirm).toContainText("They are signed out now and cannot sign in until an IT account activates them again.");
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Deactivate" }).click();

    await expect(confirm).toBeHidden();
    await expect(page.getByText("Mark Dela Cruz is deactivated")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Show deactivated accounts" })).toBeChecked();
    await expect(row(page, "Mark Dela Cruz")).toContainText("Turned off Nov 26, 2026 by Ana Reyes");
    expect(calls.find((call) => call.url.endsWith("/accounts/mark/status"))?.body).toEqual({ status: "inactive" });

    await row(page, "Mark Dela Cruz").getByRole("button", { name: "Activate Mark Dela Cruz" }).click();
    await expect(page.getByText("Mark Dela Cruz can sign in again")).toBeVisible();
    await expect(row(page, "Mark Dela Cruz")).toContainText("Can sign in");
  });

  test("sends a new invitation link", async ({ page }) => {
    const { calls } = await openPersonnel(page);
    await row(page, "Grace Bautista")
      .getByRole("button", { name: /Send a new link/ })
      .click();
    await expect(page.getByText("A new link went to grace.bautista@lgu.example.test.")).toBeVisible();
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/accounts/grace/activation"))).toBe(true);
    await expect(row(page, "Grace Bautista")).toContainText("Sent Nov 26, 2026, expires Nov 27, 2026");
  });

  test("works in dark mode", async ({ page }) => {
    await openPersonnel(page, { theme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("region", { name: /asked to change the sign-in email/ })).toBeVisible();
    await expect(row(page, "Mark Dela Cruz")).toBeVisible();
  });
});

test.describe("IT LGU Personnel on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("stacks the records without a sideways scroll", async ({ page }) => {
    await openPersonnel(page);
    const list = page.getByRole("list", { name: "LGU personnel" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list.getByRole("button", { name: "Deactivate Mark Dela Cruz" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
