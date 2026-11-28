import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/shared/lib/apiClient";
import { isTwoFactorLoginChallenge, loginService, verifyTwoFactorLogin } from "../../../../../src/features/login/services/loginService";

vi.mock("@/shared/lib/apiClient", () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

const user = {
  id: "staff-1",
  email: "staff@example.com",
  displayName: "LGU Staff",
  role: "staff" as const,
  title: "LGU Staff",
  phone: null,
  firstName: null,
  lastName: null,
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
};

describe("sign-in with two-step verification", () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });

  it("tells a session from a request for a code", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { token: "session", user } });
    const session = await loginService({ clientId: "staff@example.com", encryptionKey: "secret", rememberMe: true });
    expect(isTwoFactorLoginChallenge(session)).toBe(false);
    expect(apiClient.post).toHaveBeenCalledWith("/auth/login", { username: "staff@example.com", password: "secret", loginScope: "web", rememberMe: true });

    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { twoFactorRequired: true, challengeToken: "challenge", expiresInSeconds: 300 } });
    const challenge = await loginService({ clientId: "staff@example.com", encryptionKey: "secret" });
    expect(isTwoFactorLoginChallenge(challenge)).toBe(true);
  });

  it("sends the challenge with either an app code or a recovery code", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { token: "session", user } });

    await verifyTwoFactorLogin({ challengeToken: "challenge", code: "123456" });
    await verifyTwoFactorLogin({ challengeToken: "challenge", recoveryCode: "K7QM2-X9PRT" });

    expect(apiClient.post).toHaveBeenNthCalledWith(1, "/auth/login/two-factor", { challengeToken: "challenge", code: "123456" });
    expect(apiClient.post).toHaveBeenNthCalledWith(2, "/auth/login/two-factor", { challengeToken: "challenge", recoveryCode: "K7QM2-X9PRT" });
  });
});
