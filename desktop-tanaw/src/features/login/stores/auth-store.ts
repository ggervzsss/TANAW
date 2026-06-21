import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthRole, AuthUser, LoginResponse } from "../types";

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  setSession: (session: LoginResponse) => void;
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
      setSession: (session) =>
        set({
          token: session.token,
          user: session.user,
          isAuthenticated: true,
        }),
      updateUser: (user) =>
        set({
          user,
          isAuthenticated: true,
        }),
      logout: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
        }),
      hasRole: (roles) => {
        const role = get().user?.role;

        return role ? roles.includes(role) : false;
      },
    }),
    {
      name: "tanaw-auth-session",
    },
  ),
);
