import { describe, expect, it } from "vitest";
import { canonicalAddressKey, normalizeAddress, normalizeStreet } from "../src/address.js";

describe("normalizeStreet", () => {
  it("expands common abbreviations and lowercases", () => {
    expect(normalizeStreet("123 N. Main St.")).toBe("123 north main street");
  });

  it("collapses extra whitespace", () => {
    expect(normalizeStreet("  456   Oak   Ave  ")).toBe("456 oak avenue");
  });
});

describe("normalizeAddress", () => {
  it("normalizes unit prefixes", () => {
    const result = normalizeAddress({
      street: "1 Elm Rd",
      unit: "Apt 4B",
      postalCode: "12345-6789",
      country: "us",
    });
    expect(result).toEqual({
      street: "1 elm road",
      unit: "4b",
      postalCode: "12345",
      country: "US",
    });
  });

  it("omits unit when absent", () => {
    const result = normalizeAddress({ street: "1 Elm Rd", postalCode: "12345", country: "us" });
    expect(result.unit).toBeUndefined();
  });
});

describe("canonicalAddressKey", () => {
  it("prefers the provider address id when present", () => {
    const key = canonicalAddressKey({
      providerAddressId: "place-123",
      street: "1 Elm Rd",
      postalCode: "12345",
      country: "us",
    });
    expect(key).toBe("provider:place-123");
  });

  it("produces the same fallback key for equivalent addresses written differently", () => {
    const a = canonicalAddressKey({ street: "123 N. Main St.", unit: "Apt 4B", postalCode: "12345-6789", country: "us" });
    const b = canonicalAddressKey({ street: "123 North Main Street", unit: "4B", postalCode: "12345", country: "US" });
    expect(a).toBe(b);
  });

  it("produces different keys for different units", () => {
    const a = canonicalAddressKey({ street: "123 Main St", unit: "1", postalCode: "12345", country: "us" });
    const b = canonicalAddressKey({ street: "123 Main St", unit: "2", postalCode: "12345", country: "us" });
    expect(a).not.toBe(b);
  });
});
