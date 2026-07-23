import { create } from "zustand";
import { clearScopedPageState } from "../../../utils/page-state";
import type { AuthRole, AuthUser, LoginResponse } from "../types";

const REMEMBER_STORAGE_KEY = "tanaw-auth-session-remember";

export const isRememberEnabled = () => localStorage.getItem(REMEMBER_STORAGE_KEY) === "true";
export type AuthStatus = "checking" | "authenticated" | "anonymous";

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  setSession: (session: LoginResponse, remember?: boolean) => void;
  updateUser: (user: AuthUser) => void;
  markAnonymous: () => void;
  logout: () => void;
  hasRole: (roles: AuthRole[]) => boolean;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  token: null,
  user: null,
  status: "checking",
  isAuthenticated: false,
  setSession: (session, remember) => {
    if (remember !== undefined) localStorage.setItem(REMEMBER_STORAGE_KEY, String(remember));
    if (remember ?? isRememberEnabled()) {
      void window.tanawAuthSession?.save(session);
    } else {
      void window.tanawAuthSession?.clear();
    }
    set({ token: session.token, user: session.user, status: "authenticated", isAuthenticated: true });
  },
  updateUser: (user) => set({ user, status: "authenticated", isAuthenticated: true }),
  markAnonymous: () => {
    const user = get().user;
    if (user) {
      const scope = {
        portal: "desktop",
        role: user.role,
        userId: user.id,
      };
      clearScopedPageState(scope);
      globalThis.setTimeout(() => clearScopedPageState(scope), 0);
    }
    set({ token: null, user: null, status: "anonymous", isAuthenticated: false });
  },
  logout: () => {
    const user = get().user;
    const scope = user ? { portal: "desktop", role: user.role, userId: user.id } : null;
    if (scope) clearScopedPageState(scope);
    void window.tanawAuthSession?.clear();
    set({ token: null, user: null, status: "anonymous", isAuthenticated: false });
    if (scope) globalThis.setTimeout(() => clearScopedPageState(scope), 0);
  },
  hasRole: (roles) => {
    const role = get().user?.role;
    return role ? roles.includes(role) : false;
  },
}));
