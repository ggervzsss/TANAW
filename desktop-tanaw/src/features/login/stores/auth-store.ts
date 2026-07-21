import { create } from "zustand";
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
  markAnonymous: () => set({ token: null, user: null, status: "anonymous", isAuthenticated: false }),
  logout: () => {
    void window.tanawAuthSession?.clear();
    set({ token: null, user: null, status: "anonymous", isAuthenticated: false });
  },
  hasRole: (roles) => {
    const role = get().user?.role;
    return role ? roles.includes(role) : false;
  },
}));
