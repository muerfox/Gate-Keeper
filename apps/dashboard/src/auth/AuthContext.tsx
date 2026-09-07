import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { api, getSessionToken, setSessionToken } from "../api.js";

interface AuthState {
  isAuthenticated: boolean;
  role: string | null;
  login: (email: string, password: string, totp?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getSessionToken()));
  const [role, setRole] = useState<string | null>(null);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const result = await api.login(email, password, totp);
    setSessionToken(result.sessionToken);
    setRole(result.role);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSessionToken(null);
      setIsAuthenticated(false);
    }
  }, []);

  return <AuthContext.Provider value={{ isAuthenticated, role, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
