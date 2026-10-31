import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { getCurrentUser, isAuthConfigured, redirectToSignIn, redirectToSignOut, type AuthUser } from "./cognito";

interface AuthContextValue {
  user: AuthUser | null;
  isConfigured: boolean;
  signIn: () => void;
  signOut: () => void;
  /** Call after a successful /auth/callback token exchange to refresh the in-memory user. */
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy initializer reads any already-stored token once on first render — no effect needed.
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const refresh = useCallback(() => setUser(getCurrentUser()), []);

  const value: AuthContextValue = {
    user,
    isConfigured: isAuthConfigured(),
    signIn: () => void redirectToSignIn(),
    signOut: () => redirectToSignOut(),
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
