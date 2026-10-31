import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { consumeSignInReturnPath, exchangeCodeForTokens } from "../auth/cognito";
import { useAuth } from "../auth/AuthContext";

export function AuthCallbackScreen() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    if (oauthError) return `Sign-in failed: ${oauthError}`;
    return params.get("code") && params.get("state") ? null : "Missing authorization code — try signing in again.";
  });
  const exchange = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (params.has("error") || !code || !state) return;

    let active = true;
    exchange.current ??= exchangeCodeForTokens(code, state);
    exchange.current.then((ok) => {
      if (!active) return;
      if (!ok) {
        setError("Could not complete sign-in — try again.");
        return;
      }
      refresh();
      navigate(consumeSignInReturnPath(), { replace: true });
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Sign-in request failed.");
    });
    return () => { active = false; };
  }, [navigate, refresh]);

  return (
    <div className="screen">
      <h2>Signing you in…</h2>
      {error && <p className="muted">{error}</p>}
    </div>
  );
}
