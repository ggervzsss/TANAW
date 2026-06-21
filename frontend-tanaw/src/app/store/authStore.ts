import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { AuthUser, UserRole } from "@/shared/types/role.types";

const AUTH_STORAGE_KEY = "tanaw-auth";
const REMEMBER_STORAGE_KEY = "tanaw-auth-remember";

const getPreferredStorage = () => (localStorage.getItem(REMEMBER_STORAGE_KEY) === "true" ? localStorage : sessionStorage);

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
      setSession: (session, remember = false) => {
        if (remember) {
          localStorage.setItem(REMEMBER_STORAGE_KEY, "true");
          sessionStorage.removeItem(AUTH_STORAGE_KEY);
        } else {
          localStorage.removeItem(REMEMBER_STORAGE_KEY);
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
        set({ token: session.token, user: session.user });
      },
      updateUser: (user) => set({ user }),
      logout: () => {
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
