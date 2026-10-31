/**
 * Cognito Hosted UI integration (OAuth2 Authorization Code + PKCE, public client — no secret).
 * Config comes from env vars set after `cdk deploy` (see README "Deployment steps" / "Environment
 * variables"): without them, `isAuthConfigured()` is false and the UI shows a "not configured yet"
 * state instead of a broken sign-in button.
 */
import { generateCodeChallenge, generateCodeVerifier, generateState } from "./pkce";

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

const SESSION_KEYS = {
  codeVerifier: "candy-map.auth.code_verifier",
  state: "candy-map.auth.state",
  idToken: "candy-map.auth.id_token",
  accessToken: "candy-map.auth.access_token",
  refreshToken: "candy-map.auth.refresh_token",
} as const;

export interface AuthUser {
  sub: string;
  email?: string;
}

export function isAuthConfigured(): boolean {
  return Boolean(COGNITO_DOMAIN && CLIENT_ID);
}

export async function redirectToSignIn(): Promise<void> {
  if (!COGNITO_DOMAIN || !CLIENT_ID) return;
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  sessionStorage.setItem(SESSION_KEYS.codeVerifier, codeVerifier);
  sessionStorage.setItem(SESSION_KEYS.state, state);

  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  window.location.assign(`${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`);
}

export function redirectToSignOut(): void {
  clearTokens();
  if (!COGNITO_DOMAIN || !CLIENT_ID) return;
  const params = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: window.location.origin });
  window.location.assign(`${COGNITO_DOMAIN}/logout?${params.toString()}`);
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
}

/** Exchanges the authorization code from the callback URL for tokens. Validates `state` first. */
export async function exchangeCodeForTokens(code: string, returnedState: string): Promise<boolean> {
  const expectedState = sessionStorage.getItem(SESSION_KEYS.state);
  const codeVerifier = sessionStorage.getItem(SESSION_KEYS.codeVerifier);
  if (!expectedState || expectedState !== returnedState || !codeVerifier || !COGNITO_DOMAIN || !CLIENT_ID) {
    return false;
  }

  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) return false;

  const tokens = (await response.json()) as TokenResponse;
  sessionStorage.setItem(SESSION_KEYS.idToken, tokens.id_token);
  sessionStorage.setItem(SESSION_KEYS.accessToken, tokens.access_token);
  if (tokens.refresh_token) sessionStorage.setItem(SESSION_KEYS.refreshToken, tokens.refresh_token);
  sessionStorage.removeItem(SESSION_KEYS.codeVerifier);
  sessionStorage.removeItem(SESSION_KEYS.state);
  return true;
}

export function clearTokens(): void {
  Object.values(SESSION_KEYS).forEach((key) => sessionStorage.removeItem(key));
}

export function getIdToken(): string | null {
  return sessionStorage.getItem(SESSION_KEYS.idToken);
}

/**
 * Decodes the (already-trusted, same-session) id token payload for display purposes only — this
 * is NOT verification. Every server-side request re-verifies the token at API Gateway.
 */
export function getCurrentUser(): AuthUser | null {
  const token = getIdToken();
  if (!token) return null;
  try {
    const payloadBase64 = token.split(".")[1];
    if (!payloadBase64) return null;
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub: string;
      email?: string;
      exp: number;
    };
    if (payload.exp * 1000 < Date.now()) {
      clearTokens();
      return null;
    }
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
