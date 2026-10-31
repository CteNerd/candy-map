import { describe, expect, it } from "vitest";
import { isParticipationExpired, isPubliclyVisible } from "../src/participation.js";

const base = {
  status: "available" as const,
  publicOptIn: true,
  expiresAt: "2099-01-01T00:00:00.000Z",
};

describe("isParticipationExpired", () => {
  it("is false for a future expiry", () => {
    expect(isParticipationExpired({ expiresAt: "2099-01-01T00:00:00.000Z" }, new Date("2024-01-01"))).toBe(false);
  });

  it("is true for a past expiry", () => {
    expect(isParticipationExpired({ expiresAt: "2020-01-01T00:00:00.000Z" }, new Date("2024-01-01"))).toBe(true);
  });

  it("is true exactly at the expiry boundary", () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    expect(isParticipationExpired({ expiresAt: now.toISOString() }, now)).toBe(true);
  });
});

describe("isPubliclyVisible", () => {
  const now = new Date("2024-01-01T00:00:00.000Z");

  it("is visible when opted-in, available, and not expired", () => {
    expect(isPubliclyVisible(base, now)).toBe(true);
  });

  it("is hidden when not opted in", () => {
    expect(isPubliclyVisible({ ...base, publicOptIn: false }, now)).toBe(false);
  });

  it("is hidden when finished", () => {
    expect(isPubliclyVisible({ ...base, status: "finished" }, now)).toBe(false);
  });

  it("is hidden when expired", () => {
    expect(isPubliclyVisible({ ...base, expiresAt: "2020-01-01T00:00:00.000Z" }, now)).toBe(false);
  });

  it("is visible when status is low but not expired/finished", () => {
    expect(isPubliclyVisible({ ...base, status: "low" }, now)).toBe(true);
  });
});
