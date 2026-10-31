import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cognito auth helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports not configured when env vars are absent", async () => {
    const { isAuthConfigured } = await import("../src/auth/cognito");
    expect(isAuthConfigured()).toBe(false);
  });

  it("returns null for the current user when no token is stored", async () => {
    const { getCurrentUser } = await import("../src/auth/cognito");
    expect(getCurrentUser()).toBeNull();
  });

  it("fails to exchange a code when no matching state was stored (CSRF guard)", async () => {
    const { exchangeCodeForTokens } = await import("../src/auth/cognito");
    const ok = await exchangeCodeForTokens("some-code", "unmatched-state");
    expect(ok).toBe(false);
  });

  it("decodes a validly-shaped id token into a user", async () => {
    const { getCurrentUser } = await import("../src/auth/cognito");
    const payload = { sub: "user-123", email: "resident@example.com", exp: Math.floor(Date.now() / 1000) + 3600 };
    const base64url = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fakeToken = `${base64url({ alg: "none" })}.${base64url(payload)}.signature`;
    sessionStorage.setItem("candy-map.auth.id_token", fakeToken);

    const user = getCurrentUser();
    expect(user).toEqual({ sub: "user-123", email: "resident@example.com" });
  });

  it("treats an expired id token as signed out", async () => {
    const { getCurrentUser } = await import("../src/auth/cognito");
    const payload = { sub: "user-123", exp: Math.floor(Date.now() / 1000) - 10 };
    const base64url = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fakeToken = `${base64url({ alg: "none" })}.${base64url(payload)}.signature`;
    sessionStorage.setItem("candy-map.auth.id_token", fakeToken);

    expect(getCurrentUser()).toBeNull();
  });
});
