import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../../../src/features/login/stores/auth-store";
import type { AuthUser } from "../../../../src/features/login/types";
import { staffApi } from "../../../../src/lib/axios";

const authenticatedUser: AuthUser = {
  id: "desktop-api-client-test-user",
  name: "Desktop API Client Test User",
  email: "desktop-api-client@example.test",
  role: "enterprise",
  enterpriseId: "desktop_api_test@tanaw.sanpedro",
  enterpriseName: "Desktop API Client Test Enterprise",
};

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function responseError(status: number) {
  return Object.assign(new Error(`Request failed with status ${status}`), {
    response: { status },
  });
}

function requestRejectingWith(error: Error) {
  return staffApi.get("/interceptor-test", {
    adapter: (config) => Promise.reject(Object.assign(error, { config })),
  });
}

function legacyRequestRejectingWith(error: Error) {
  return staffApi.get("/interceptor-test", {
    adapter: () => Promise.reject(error),
  });
}

describe("staff API authentication failures", () => {
  const clearPersistedSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    clearPersistedSession.mockClear();
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("window", {
      sessionStorage: createStorage(),
      tanawAuthSession: { clear: clearPersistedSession },
    });
    useAuthStore.setState({
      status: "authenticated",
      isAuthenticated: true,
      token: "valid-desktop-session-token",
      user: authenticatedUser,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useAuthStore.setState({
      status: "checking",
      isAuthenticated: false,
      token: null,
      user: null,
    });
    vi.unstubAllGlobals();
  });

  it("invalidates an authenticated session on HTTP 401", async () => {
    const error = responseError(401);

    await expect(requestRejectingWith(error)).rejects.toBe(error);

    expect(useAuthStore.getState()).toMatchObject({
      status: "anonymous",
      isAuthenticated: false,
      token: null,
      user: null,
    });
    expect(clearPersistedSession).toHaveBeenCalledOnce();
  });

  it("keeps a session's own token on a request pinned to it", async () => {
    let sent: unknown;
    await staffApi.get("/interceptor-test", {
      headers: { Authorization: "Bearer earlier-session-token" },
      adapter: (config) => {
        sent = config.headers.Authorization;
        return Promise.resolve({ data: null, status: 200, statusText: "OK", headers: {}, config });
      },
    });

    expect(sent).toBe("Bearer earlier-session-token");
  });

  it("keeps the current session when an earlier session's request returns HTTP 401", async () => {
    const error = responseError(401);

    await expect(
      staffApi.get("/interceptor-test", {
        headers: { Authorization: "Bearer earlier-session-token" },
        adapter: (config) => Promise.reject(Object.assign(error, { config })),
      }),
    ).rejects.toBe(error);

    expect(useAuthStore.getState()).toMatchObject({ status: "authenticated", token: "valid-desktop-session-token" });
    expect(clearPersistedSession).not.toHaveBeenCalled();
  });

  it("invalidates the session for an HTTP 401 without request details", async () => {
    const error = responseError(401);

    await expect(legacyRequestRejectingWith(error)).rejects.toBe(error);

    expect(useAuthStore.getState()).toMatchObject({ status: "anonymous", token: null });
  });

  it("keeps the session and rejects with the original HTTP 403 error", async () => {
    const error = responseError(403);

    await expect(requestRejectingWith(error)).rejects.toBe(error);

    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      isAuthenticated: true,
      token: "valid-desktop-session-token",
      user: authenticatedUser,
    });
    expect(clearPersistedSession).not.toHaveBeenCalled();
  });

  it("keeps the enterprise session available for retry after a request timeout", async () => {
    const error = Object.assign(new Error("Request timed out"), { code: "ECONNABORTED" });

    await expect(requestRejectingWith(error)).rejects.toBe(error);

    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      token: "valid-desktop-session-token",
      user: authenticatedUser,
    });
    expect(clearPersistedSession).not.toHaveBeenCalled();
  });
});
