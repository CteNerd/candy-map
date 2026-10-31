/**
 * Server-side authorization rules. These must be enforced in every Lambda handler — never
 * trusted from the frontend. See COPILOT_PLAN.md "Security and privacy".
 */

import type { ClaimStatus, HouseClaim, MembershipRole } from "./types.js";

export interface ActorContext {
  userId: string;
  /** Neighborhood ids where this user has an active organizer membership. */
  organizerOfNeighborhoodIds: string[];
}

/**
 * Only an approved claimant for the specific house, or an organizer of that house's
 * neighborhood, may change candy status. A pending/rejected/disputed claim grants no rights.
 */
export function canModifyCandyStatus(
  actor: ActorContext,
  house: { neighborhoodId: string },
  claim: Pick<HouseClaim, "userId" | "status"> | undefined,
): boolean {
  if (actor.organizerOfNeighborhoodIds.includes(house.neighborhoodId)) return true;
  if (!claim) return false;
  return claim.userId === actor.userId && claim.status === "approved";
}

export function canApproveClaim(actor: ActorContext, house: { neighborhoodId: string }): boolean {
  return actor.organizerOfNeighborhoodIds.includes(house.neighborhoodId);
}

/** A claim never silently replaces an existing approved claimant (see plan: "House claim requests"). */
export function canSubmitClaim(existingApprovedClaim: Pick<HouseClaim, "status"> | undefined): {
  allowed: boolean;
  resultingStatus: ClaimStatus;
} {
  if (existingApprovedClaim?.status === "approved") {
    return { allowed: true, resultingStatus: "disputed" };
  }
  return { allowed: true, resultingStatus: "pending" };
}

export function roleGrantsOrganizerAccess(role: MembershipRole): boolean {
  return role === "organizer";
}
