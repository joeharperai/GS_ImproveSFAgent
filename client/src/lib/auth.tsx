import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { setAuthToken } from "./queryClient";

// Use the same API_BASE as queryClient for URL rewriting in deployed environments
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  setupRequired: boolean | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  // On mount, try to restore session from localStorage, then check setup
  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      // Try to restore token from localStorage
      const savedToken = localStorage.getItem("gs_auth_token");
      const savedUser = localStorage.getItem("gs_auth_user");
      if (savedToken && savedUser) {
        // Verify the token is still valid
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setToken(savedToken);
          setAuthToken(savedToken);
          setSetupRequired(false);
          setIsLoading(false);
          return;
        } else {
          // Token expired or invalid — clear it
          localStorage.removeItem("gs_auth_token");
          localStorage.removeItem("gs_auth_user");
        }
      }
    } catch {
      // localStorage might not be available — fall through
    }
    await checkSetup();
  }

  async function checkSetup() {
    try {
      const res = await fetch(`${API_BASE}/api/auth/setup-required`);
      if (res.ok) {
        const data = await res.json();
        setSetupRequired(data.setupRequired);
      }
    } catch {
      // Server not reachable — will show auth page anyway
    } finally {
      setIsLoading(false);
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Login failed");
    }

    const data = await res.json();
    setUser(data.user);
    setToken(data.token);
    setAuthToken(data.token);
    setSetupRequired(false);
    try { localStorage.setItem("gs_auth_token", data.token); localStorage.setItem("gs_auth_user", JSON.stringify(data.user)); } catch {}
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName: string) => {
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Signup failed");
    }

    const data = await res.json();
    setUser(data.user);
    setToken(data.token);
    setAuthToken(data.token);
    setSetupRequired(false);
    try { localStorage.setItem("gs_auth_token", data.token); localStorage.setItem("gs_auth_user", JSON.stringify(data.user)); } catch {}
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Best-effort
      }
    }
    setUser(null);
    setToken(null);
    setAuthToken(null);
    try { localStorage.removeItem("gs_auth_token"); localStorage.removeItem("gs_auth_user"); } catch {}
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, setupRequired, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
