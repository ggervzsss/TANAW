import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { AuthRole, AuthUser, LoginResponse } from "../types";

const AUTH_STORAGE_KEY = "tanaw-auth-session";
const REMEMBER_STORAGE_KEY = "tanaw-auth-session-remember";

export const isRememberEnabled = () => localStorage.getItem(REMEMBER_STORAGE_KEY) === "true";

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
  isAuthenticated: boolean;
  setSession: (session: LoginResponse, remember?: boolean) => void;
  updateUser: (user: AuthUser) => void;
  logout: () => void;
  hasRole: (roles: AuthRole[]) => boolean;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      setSession: (session, remember = isRememberEnabled()) => {
        if (remember) {
          localStorage.setItem(REMEMBER_STORAGE_KEY, "true");
          sessionStorage.removeItem(AUTH_STORAGE_KEY);
        } else {
          localStorage.removeItem(REMEMBER_STORAGE_KEY);
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
        set({
          token: session.token,
          user: session.user,
          isAuthenticated: true,
        });
      },
      updateUser: (user) =>
        set({
          user,
          isAuthenticated: true,
        }),
      logout: () => {
        localStorage.removeItem(REMEMBER_STORAGE_KEY);
        authStorage.removeItem(AUTH_STORAGE_KEY);
        set({
          token: null,
          user: null,
          isAuthenticated: false,
        });
      },
      hasRole: (roles) => {
        const role = get().user?.role;

        return role ? roles.includes(role) : false;
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => authStorage),
    },
  ),
);
