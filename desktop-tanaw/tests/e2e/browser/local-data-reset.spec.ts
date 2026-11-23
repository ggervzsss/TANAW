import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";
import { defaultEnterpriseUser, signIn } from "./support/session";
import { switchTheme } from "../support/theme-and-filters";

const unreadable = {
  code: "local_database_reset_required",
  message: "The local TANAW data on this computer was saved by an earlier version and cannot be upgraded by this application.",
};

async function signInWithUnreadableData(page: Page, resetResponse: () => { status: number; body: unknown }) {
  const resetRequests: unknown[] = [];
  let reset = false;
  await signIn(page, async () => {
    await mockMlRequest(page, "/context/enterprise", () =>
      reset
        ? mlResponse({ status: 200, body: JSON.stringify({ enterprise_id: defaultEnterpriseUser.enterpriseId, enterprise_name: defaultEnterpriseUser.enterpriseName, changed: true, session_restored: false }) })
        : mlResponse({ status: 409, body: JSON.stringify(unreadable) }),
    );
    await mockMlRequest(page, "/context/enterprise/reset-local-data", (request) => {
      resetRequests.push(JSON.parse(request.body ?? "null"));
      const response = resetResponse();
      reset = response.status === 200;
      return mlResponse({ status: response.status, body: JSON.stringify(response.body) });
    });
  });
  return resetRequests;
}

test("unreadable local data offers a confirmed reset instead of a developer command", async ({ page }) => {
  const resetRequests = await signInWithUnreadableData(page, () => ({ status: 200, body: { enterprise_id: defaultEnterpriseUser.enterpriseId, set_aside_path: "set-aside/park" } }));

  const card = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Local data needs a reset" }) });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("npm");
  await expect(card).toContainText("cannot open the data that an earlier version saved");
  await switchTheme(page, "light");

  await card.getByRole("button", { name: "Reset local data" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset local data?" });
  await expect(dialog).toContainText("Camera usernames and passwords saved on this computer are kept.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(resetRequests).toEqual([]);

  await card.getByRole("button", { name: "Reset local data" }).click();
  await dialog.getByRole("button", { name: "Reset local data" }).click();

  await expect(page.getByRole("heading", { name: "Local data needs a reset" })).toHaveCount(0);
  await expect(page.getByText("Local data was reset. TANAW is starting with fresh local data.")).toBeVisible();
  expect(resetRequests).toEqual([{ enterprise_id: defaultEnterpriseUser.enterpriseId }]);
});

test("a refused reset keeps the data and explains why", async ({ page }) => {
  await signInWithUnreadableData(page, () => ({ status: 409, body: { detail: { code: "local_data_readable", message: "This establishment's local data is readable; nothing was reset." } } }));

  const card = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Local data needs a reset" }) });
  await card.getByRole("button", { name: "Reset local data" }).click();
  await page.getByRole("dialog", { name: "Reset local data?" }).getByRole("button", { name: "Reset local data" }).click();

  await expect(page.getByRole("dialog", { name: "Reset local data?" })).toHaveCount(0);
  await expect(card).toContainText("nothing was reset");
  await expect(page.getByRole("heading", { name: "Local data needs a reset" })).toBeVisible();
});
