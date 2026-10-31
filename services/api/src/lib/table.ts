/**
 * Single-table DynamoDB key schema.
 *
 * Entity layout (partition key `pk`, sort key `sk`):
 *   NEIGHBORHOOD#<id>      | METADATA              -> Neighborhood
 *   NEIGHBORHOOD#<id>      | MEMBERSHIP#<userId>    -> NeighborhoodMembership
 *   HOUSE#<id>             | METADATA               -> House
 *   HOUSE#<id>             | CLAIM#<userId>         -> HouseClaim
 *   HOUSE#<id>             | PARTICIPATION#<season> -> CandyParticipation
 *   HOUSE#<id>             | REPORT#<reportId>      -> CandyReport
 *   HOUSE_KEY#<addressHash>| RESERVATION            -> { houseId } (dedupe reservation)
 *   NBHD_LOCK#<gridCell>   | RESERVATION            -> neighborhood-creation spatial lock (Milestone 4)
 *   AUDIT#<id>             | EVENT#<timestamp>      -> AuditEvent
 *
 * GSI1 (gsi1pk/gsi1sk) overloads two access patterns:
 *   House METADATA item:  gsi1pk = NEIGHBORHOOD#<neighborhoodId>, gsi1sk = HOUSE#<houseId>
 *     -> "list houses in a neighborhood" (GET /neighborhoods/{id}/houses)
 *   HouseClaim item:      gsi1pk = USER#<userId>,                 gsi1sk = CLAIM#<houseId>
 *     -> "list my claims" (GET /me/claims, Milestone 3)
 *
 * Neighborhood candidate/duplicate search (Milestone 4) scans the table rather than using a
 * geohash GSI — per COPILOT_PLAN.md: "POC may scan one small regional set". Replace with a real
 * geohash/S2-based index before scaling past one region.
 */

export interface TableKey {
  pk: string;
  sk: string;
}

export interface Gsi1Key {
  gsi1pk: string;
  gsi1sk: string;
}

export function neighborhoodKey(neighborhoodId: string): TableKey {
  return { pk: `NEIGHBORHOOD#${neighborhoodId}`, sk: "METADATA" };
}

export function neighborhoodMembershipKey(neighborhoodId: string, userId: string): TableKey {
  return { pk: `NEIGHBORHOOD#${neighborhoodId}`, sk: `MEMBERSHIP#${userId}` };
}

export function houseKey(houseId: string): TableKey {
  return { pk: `HOUSE#${houseId}`, sk: "METADATA" };
}

export function houseClaimKey(houseId: string, userId: string): TableKey {
  return { pk: `HOUSE#${houseId}`, sk: `CLAIM#${userId}` };
}

export function houseParticipationKey(houseId: string, seasonId: string): TableKey {
  return { pk: `HOUSE#${houseId}`, sk: `PARTICIPATION#${seasonId}` };
}

export function houseReportKey(houseId: string, reportId: string): TableKey {
  return { pk: `HOUSE#${houseId}`, sk: `REPORT#${reportId}` };
}

export function houseKeyReservationKey(canonicalAddressKey: string): TableKey {
  return { pk: `HOUSE_KEY#${canonicalAddressKey}`, sk: "RESERVATION" };
}

export function neighborhoodLockKey(gridCellId: string): TableKey {
  return { pk: `NBHD_LOCK#${gridCellId}`, sk: "RESERVATION" };
}

/** Per-(user, house, action) rate-limit window — see lib/rateLimit.ts. */
export function rateLimitKey(action: string, userId: string, houseId: string): TableKey {
  return { pk: `RATE#${action}#${userId}#${houseId}`, sk: "WINDOW" };
}

export function houseGsi1(neighborhoodId: string, houseId: string): Gsi1Key {
  return { gsi1pk: `NEIGHBORHOOD#${neighborhoodId}`, gsi1sk: `HOUSE#${houseId}` };
}

export function claimGsi1(userId: string, houseId: string): Gsi1Key {
  return { gsi1pk: `USER#${userId}`, gsi1sk: `CLAIM#${houseId}` };
}

/** Candy-handing-out season id. One POC season per calendar year. */
export function getCurrentSeasonId(now = new Date()): string {
  return String(now.getFullYear());
}

export function getTableName(): string {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error("TABLE_NAME environment variable is not set");
  }
  return tableName;
}
