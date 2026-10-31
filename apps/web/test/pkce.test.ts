import { describe, expect, it } from "vitest";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "../src/auth/pkce";

const BASE64URL_SAFE = /^[A-Za-z0-9_-]+$/;

describe("PKCE helpers", () => {
  it("generates a base64url-safe code verifier with no padding", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThan(20);
    expect(verifier).toMatch(BASE64URL_SAFE);
  });

  it("generates a different verifier each time", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("derives a deterministic SHA-256 code challenge from a given verifier", async () => {
    const verifier = "fixed-test-verifier-value";
    const challengeA = await generateCodeChallenge(verifier);
    const challengeB = await generateCodeChallenge(verifier);
    expect(challengeA).toBe(challengeB);
    expect(challengeA).toMatch(BASE64URL_SAFE);
  });

  it("generates a base64url-safe state value", () => {
    expect(generateState()).toMatch(BASE64URL_SAFE);
  });
});
