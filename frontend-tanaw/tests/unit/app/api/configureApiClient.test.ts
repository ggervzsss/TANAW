import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/app/store/authStore";
import { configureWebApiClientAuthentication } from "@/app/api/configureApiClient";
import type { AuthUser } from "@/shared/types/role.types";
import { apiClient } from "@/shared/lib/apiClient";

const authenticatedUser: AuthUser = {
  id: "api-client-test-user",
  email: "api-client@example.test",
  displayName: "API Client Test User",
  role: "staff",
  title: "LGU Staff",
  phone: null,
  firstName: "API",
  lastName: "Client",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
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
  return apiClient.get("/interceptor-test", {
    adapter: () => Promise.reject(error),
  });
}

describe("API client authentication failures", () => {
  let resetAuthentication: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    const localStorage = createStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { sessionStorage: createStorage() });
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("crypto", { randomUUID: () => "api-client-test-event" });
    useAuthStore.setState({
      status: "authenticated",
      token: "valid-session-token",
      user: authenticatedUser,
    });
    resetAuthentication = configureWebApiClientAuthentication();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useAuthStore.setState({ status: "checking", token: null, user: null });
    resetAuthentication();
    vi.unstubAllGlobals();
  });

  it("invalidates an authenticated session on HTTP 401", async () => {
    const error = responseError(401);

    await expect(requestRejectingWith(error)).rejects.toBe(error);

    expect(useAuthStore.getState()).toMatchObject({
      status: "anonymous",
      token: null,
      user: null,
    });
  });

  it("keeps the session and rejects with the original HTTP 403 error", async () => {
    const error = responseError(403);

    await expect(requestRejectingWith(error)).rejects.toBe(error);

    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      token: "valid-session-token",
      user: authenticatedUser,
    });
  });
});
