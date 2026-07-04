"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { ReelIcon } from "@/components/reel-icon";
import { api } from "@/lib/api";
import { notifyAndroidLogout } from "@/lib/android-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AuthState = {
  loading: boolean;
  required: boolean;
  authenticated: boolean;
  refresh: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);

  const refresh = useCallback(async () => {
    const status = await api.getAuthStatus();
    setRequired(status.required);
    setAuthenticated(status.authenticated);
  }, []);

  useEffect(() => {
    refresh()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (password: string) => {
      await api.login(password);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.logout();
    notifyAndroidLogout();
    await refresh();
  }, [refresh]);

  const locked = required && !authenticated;

  return (
    <AuthContext.Provider
      value={{ loading, required, authenticated, refresh, login, logout }}
    >
      {children}
      {!loading && locked && <LoginGate onLogin={login} />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

function LoginGate({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(password);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-md border border-border/80 bg-card p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <ReelIcon className="h-12 w-12" />
          <div>
            <h1 className="text-2xl font-bold">Reel</h1>
            <p className="text-sm text-muted-foreground">Enter your password to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting || !password}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}
