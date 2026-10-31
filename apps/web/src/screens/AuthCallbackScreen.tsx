import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exchangeCodeForTokens } from "../auth/cognito";
import { useAuth } from "../auth/AuthContext";

export function AuthCallbackScreen() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      setError(`Sign-in failed: ${oauthError}`);
      return;
    }
    if (!code || !state) {
      setError("Missing authorization code — try signing in again.");
      return;
    }

    exchangeCodeForTokens(code, state).then((ok) => {
      if (!ok) {
        setError("Could not complete sign-in — try again.");
        return;
      }
      refresh();
      navigate("/dashboard", { replace: true });
    });
    // Intentionally run once: re-running on every render would re-submit the one-time code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="screen">
      <h2>Signing you in…</h2>
      {error && <p className="muted">{error}</p>}
    </div>
  );
}
