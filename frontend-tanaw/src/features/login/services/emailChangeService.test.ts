import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/shared/lib/apiClient";
import { verifyAccountEmailChange } from "./emailChangeService";

vi.mock("@/shared/lib/apiClient", () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

describe("email-change verification", () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });

  it("shares one request when React Strict Mode starts verification twice", async () => {
    const result = {
      displayName: "Sample Enterprise",
      requestedEmail: "updated@example.com",
      status: "verified" as const,
    };
    vi.mocked(apiClient.post).mockResolvedValue({ data: result });

    const firstVerification = verifyAccountEmailChange("  strict-mode-token  ");
    const repeatedVerification = verifyAccountEmailChange("strict-mode-token");

    await expect(Promise.all([firstVerification, repeatedVerification])).resolves.toEqual([result, result]);
    expect(apiClient.post).toHaveBeenCalledOnce();
    expect(apiClient.post).toHaveBeenCalledWith("/auth/email-change/verify", {
      token: "strict-mode-token",
    });
  });

  it("reuses a successful result instead of resubmitting the single-use token", async () => {
    const result = {
      displayName: "Another Enterprise",
      requestedEmail: "another@example.com",
      status: "verified" as const,
    };
    vi.mocked(apiClient.post).mockResolvedValue({ data: result });

    await verifyAccountEmailChange("completed-token");
    await expect(verifyAccountEmailChange("completed-token")).resolves.toEqual(result);

    expect(apiClient.post).toHaveBeenCalledOnce();
  });

  it("allows a temporary failure to be retried", async () => {
    const result = {
      displayName: "Retry Enterprise",
      requestedEmail: "retry@example.com",
      status: "verified" as const,
    };
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error("Temporary network failure")).mockResolvedValueOnce({ data: result });

    await expect(verifyAccountEmailChange("retry-token")).rejects.toThrow("Temporary network failure");
    await expect(verifyAccountEmailChange("retry-token")).resolves.toEqual(result);

    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });
});
