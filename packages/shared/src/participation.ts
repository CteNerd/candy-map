/**
 * Candy participation status/expiry rules.
 * "A finished/expired house disappears from available results" (acceptance criteria).
 */

import type { CandyParticipation } from "./types.js";

export function isParticipationExpired(participation: Pick<CandyParticipation, "expiresAt">, now = new Date()): boolean {
  return new Date(participation.expiresAt).getTime() <= now.getTime();
}

/**
 * A participation is visible on the *public* map only if it opted in, isn't expired, and isn't
 * marked finished.
 */
export function isPubliclyVisible(
  participation: Pick<CandyParticipation, "expiresAt" | "status" | "publicOptIn">,
  now = new Date(),
): boolean {
  if (!participation.publicOptIn) return false;
  if (participation.status === "finished") return false;
  if (isParticipationExpired(participation, now)) return false;
  return true;
}
