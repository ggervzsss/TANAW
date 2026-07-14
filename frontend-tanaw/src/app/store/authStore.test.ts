import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/shared/types/role.types";

const resetAuthenticatedQueryCache = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/queryClient", () => ({ resetAuthenticatedQueryCache }));

type AuthStore = typeof import("./authStore").useAuthStore;
let useAuthStore: AuthStore;

beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createMemoryStorage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: createMemoryStorage() });
  ({ useAuthStore } = await import("./authStore"));
});

beforeEach(() => {
  resetAuthenticatedQueryCache.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.setState({ token: null, user: null });
});

describe("auth store query boundaries", () => {
  it("clears cached protected data when a token is replaced", () => {
    const user = createUser("account-1", "staff");
    useAuthStore.setState({ token: "old-token", user });

    useAuthStore.getState().setSession({ token: "new-token", user });

    expect(resetAuthenticatedQueryCache).toHaveBeenCalledOnce();
  });

  it("clears cached protected data when the account authorization scope changes", () => {
    useAuthStore.setState({ token: "token", user: createUser("account-1", "staff") });

    useAuthStore.getState().updateUser(createUser("account-1", "admin"));

    expect(resetAuthenticatedQueryCache).toHaveBeenCalledOnce();
  });

  it("does not clear queries for a profile-only update in the same authorization scope", () => {
    const user = createUser("account-1", "staff");
    useAuthStore.setState({ token: "token", user });

    useAuthStore.getState().updateUser({ ...user, displayName: "Updated name" });

    expect(resetAuthenticatedQueryCache).not.toHaveBeenCalled();
  });

  it("clears cached protected data on logout", () => {
    useAuthStore.setState({ token: "token", user: createUser("account-1", "staff") });

    useAuthStore.getState().logout();

    expect(resetAuthenticatedQueryCache).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});

function createUser(id: string, role: AuthUser["role"]): AuthUser {
  return {
    id,
    email: `${id}@example.test`,
    displayName: id,
    role,
    title: "Operator",
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseId: role === "enterprise" ? "enterprise-1" : null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    buildingCapacity: 0,
    displayImageUrl: null,
  };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
