import { describe, expect, it } from "vitest";
import { canApproveClaim, canModifyCandyStatus, canSubmitClaim } from "../src/authorization.js";

const house = { neighborhoodId: "n1" };

describe("canModifyCandyStatus", () => {
  it("allows an organizer of the neighborhood regardless of claim", () => {
    const actor = { userId: "u1", organizerOfNeighborhoodIds: ["n1"] };
    expect(canModifyCandyStatus(actor, house, undefined)).toBe(true);
  });

  it("denies a non-organizer with no claim", () => {
    const actor = { userId: "u1", organizerOfNeighborhoodIds: [] };
    expect(canModifyCandyStatus(actor, house, undefined)).toBe(false);
  });

  it("denies the claimant while claim is pending", () => {
    const actor = { userId: "u1", organizerOfNeighborhoodIds: [] };
    expect(canModifyCandyStatus(actor, house, { userId: "u1", status: "pending" })).toBe(false);
  });

  it("allows the claimant once approved", () => {
    const actor = { userId: "u1", organizerOfNeighborhoodIds: [] };
    expect(canModifyCandyStatus(actor, house, { userId: "u1", status: "approved" })).toBe(true);
  });

  it("denies a different user even if some claim is approved", () => {
    const actor = { userId: "u2", organizerOfNeighborhoodIds: [] };
    expect(canModifyCandyStatus(actor, house, { userId: "u1", status: "approved" })).toBe(false);
  });
});

describe("canApproveClaim", () => {
  it("allows only organizers of that neighborhood", () => {
    expect(canApproveClaim({ userId: "u1", organizerOfNeighborhoodIds: ["n1"] }, house)).toBe(true);
    expect(canApproveClaim({ userId: "u1", organizerOfNeighborhoodIds: ["n2"] }, house)).toBe(false);
  });
});

describe("canSubmitClaim", () => {
  it("marks a new claim pending when there is no existing approved claim", () => {
    expect(canSubmitClaim(undefined)).toEqual({ allowed: true, resultingStatus: "pending" });
  });

  it("never silently replaces an approved claimant; marks the new one disputed instead", () => {
    expect(canSubmitClaim({ status: "approved" })).toEqual({ allowed: true, resultingStatus: "disputed" });
  });
});
