"use client";

/**
 * Soft RBAC placeholder (M1).
 * Will mirror oee-platform AuthContext: demo password + role switcher, UI-only.
 */

import { createContext, useContext } from "react";
import type { Role } from "@/domain/types";

type AuthState = {
  role: Role | null;
  ready: boolean;
};

const AuthContext = createContext<AuthState>({ role: null, ready: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{ role: null, ready: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
