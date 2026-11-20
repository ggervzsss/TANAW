import { beforeEach, expect, it, vi } from "vitest";
import { apiClient, getApiAccountId } from "@/shared/lib/apiClient";
import { updateAccountPreferences } from "@/shared/services/accountService";

vi.mock("@/shared/lib/apiClient", () => ({
  apiClient: { patch: vi.fn() },
  getApiAccountId: vi.fn(),
}));

const patch = vi.mocked(apiClient.patch);
const accountId = vi.mocked(getApiAccountId);

beforeEach(() => {
  patch.mockReset();
  accountId.mockReturnValue("first-account");
});

it("saves theme and display updates in order", async () => {
  let finishTheme!: () => void;
  patch.mockImplementationOnce(
    () => new Promise((resolve) => {
      finishTheme = () => resolve({ data: { theme: "dark" } });
    }),
  );
  patch.mockResolvedValueOnce({ data: { theme: "dark", textSize: "large" } });

  const theme = updateAccountPreferences({ theme: "dark" });
  const display = updateAccountPreferences({ textSize: "large" });
  await Promise.resolve();
  expect(patch.mock.calls).toEqual([["/auth/preferences", { theme: "dark" }]]);

  finishTheme();
  await theme;
  await expect(display).resolves.toMatchObject({ theme: "dark", textSize: "large" });
  expect(patch).toHaveBeenNthCalledWith(2, "/auth/preferences", { textSize: "large" });
});

it("drops a queued update after an account switch and allows the next account to save", async () => {
  patch.mockResolvedValueOnce({ data: { theme: "dark" } });
  const started = updateAccountPreferences({ theme: "dark" });
  const queued = updateAccountPreferences({ textSize: "large" });
  const skipped = expect(queued).rejects.toThrow("Account changed");
  await Promise.resolve();
  accountId.mockReturnValue("second-account");
  await started;
  await skipped;
  expect(patch).toHaveBeenCalledTimes(1);

  patch.mockResolvedValueOnce({ data: { theme: "light" } });
  await expect(updateAccountPreferences({ theme: "light" })).resolves.toMatchObject({ theme: "light" });
});
