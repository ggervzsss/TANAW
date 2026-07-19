import { create } from "zustand";
import type { AuthUser, UserRole } from "@/shared/types/role.types";

const REMEMBER_STORAGE_KEY = "tanaw-auth-remember";

export type AuthStatus = "checking" | "authenticated" | "anonymous";

type AuthState = {
  status: AuthStatus;
  token: string | null;
  user: AuthUser | null;
  setSession: (session: { token: string; user: AuthUser }, remember?: boolean) => void;
  updateUser: (user: AuthUser) => void;
  markAnonymous: () => void;
  logout: () => void;
  hasRole: (roles: UserRole[]) => boolean;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "checking",
  token: null,
  user: null,
  setSession: (session, remember) => {
    if (remember !== undefined) {
      localStorage.setItem(REMEMBER_STORAGE_KEY, String(remember));
    }
    set({ status: "authenticated", token: session.token, user: session.user });
  },
  updateUser: (user) => set({ status: "authenticated", user }),
  markAnonymous: () => set({ status: "anonymous", token: null, user: null }),
  logout: () => set({ status: "anonymous", token: null, user: null }),
  hasRole: (roles) => {
    const user = get().user;
    return Boolean(user && roles.includes(user.role));
  },
}));
