import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { resetAuthenticatedQueryCache } from "@/shared/lib/queryClient";
import type { AuthUser, UserRole } from "@/shared/types/role.types";

const AUTH_STORAGE_KEY = "tanaw-auth";
const REMEMBER_STORAGE_KEY = "tanaw-auth-remember";

const isRememberEnabled = () => localStorage.getItem(REMEMBER_STORAGE_KEY) === "true";

const getPreferredStorage = () => (isRememberEnabled() ? localStorage : sessionStorage);

const authStorage: StateStorage = {
  getItem: (name) => getPreferredStorage().getItem(name),
  setItem: (name, value) => getPreferredStorage().setItem(name, value),
  removeItem: (name) => {
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  setSession: (session: { token: string; user: AuthUser }, remember?: boolean) => void;
  updateUser: (user: AuthUser) => void;
  logout: () => void;
  hasRole: (roles: UserRole[]) => boolean;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setSession: (session, remember = isRememberEnabled()) => {
        const current = get();
        if (hasAuthBoundaryChanged(current, session)) {
          resetAuthenticatedQueryCache();
        }
        if (remember) {
          localStorage.setItem(REMEMBER_STORAGE_KEY, "true");
          sessionStorage.removeItem(AUTH_STORAGE_KEY);
        } else {
          localStorage.removeItem(REMEMBER_STORAGE_KEY);
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
        set({ token: session.token, user: session.user });
      },
      updateUser: (user) => {
        if (hasAccountScopeChanged(get().user, user)) {
          resetAuthenticatedQueryCache();
        }
        set({ user });
      },
      logout: () => {
        resetAuthenticatedQueryCache();
        localStorage.removeItem(REMEMBER_STORAGE_KEY);
        authStorage.removeItem(AUTH_STORAGE_KEY);
        set({ token: null, user: null });
      },
      hasRole: (roles) => {
        const user = get().user;
        return Boolean(user && roles.includes(user.role));
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
);

function hasAuthBoundaryChanged(current: Pick<AuthState, "token" | "user">, next: { token: string; user: AuthUser }) {
  return current.token !== next.token || hasAccountScopeChanged(current.user, next.user);
}

function hasAccountScopeChanged(current: AuthUser | null, next: AuthUser) {
  return current?.id !== next.id || current.role !== next.role || current.enterpriseId !== next.enterpriseId;
}
