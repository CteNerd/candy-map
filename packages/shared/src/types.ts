/**
 * Shared domain types for Candy Map. Mirrors the "Data entities" section of COPILOT_PLAN.md.
 * These are the DynamoDB item shapes (minus internal partition/sort key plumbing) shared between
 * the API Lambdas and any CDK test fixtures / the web app's type-only imports.
 */

export type NeighborhoodStatus = "active" | "pending_review" | "archived";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** GeoJSON Polygon, first ring only is used for POC validation (no interior holes). */
export interface PolygonGeoJSON {
  type: "Polygon";
  coordinates: number[][][];
}

export interface Neighborhood {
  id: string;
  name: string;
  normalizedName: string;
  polygon: PolygonGeoJSON;
  bbox: BoundingBox;
  centroid: GeoPoint;
  status: NeighborhoodStatus;
  organizerIds: string[];
  parentNeighborhoodId?: string;
  createdBy: string;
  createdAt: string;
}

export type MembershipRole = "organizer" | "resident";
export type MembershipState = "active" | "pending" | "removed";

export interface NeighborhoodMembership {
  neighborhoodId: string;
  userId: string;
  role: MembershipRole;
  state: MembershipState;
}

export type HouseVisibility = "public" | "private";

export interface House {
  id: string;
  canonicalAddressKey: string;
  /** Never returned by public endpoints. */
  addressDisplayPrivate: string;
  point: GeoPoint;
  neighborhoodId: string;
  visibility: HouseVisibility;
  createdAt: string;
}

export type ClaimVerificationLevel = "self_reported" | "organizer_approved";
export type ClaimStatus = "pending" | "approved" | "rejected" | "disputed";

export interface HouseClaim {
  houseId: string;
  userId: string;
  verificationLevel: ClaimVerificationLevel;
  status: ClaimStatus;
  createdAt: string;
  updatedAt: string;
}

export type CandyStatus = "available" | "low" | "finished";

export interface CandyParticipation {
  houseId: string;
  seasonId: string;
  status: CandyStatus;
  updatedAt: string;
  expiresAt: string;
  publicOptIn: boolean;
}

export type ModerationState = "pending" | "accepted" | "rejected";

export interface CandyReport {
  id: string;
  houseId: string;
  reporterId: string;
  status: CandyStatus;
  createdAt: string;
  moderationState: ModerationState;
}

export interface AuditEvent {
  actorId: string;
  action: string;
  entityId: string;
  timestamp: string;
  details?: Record<string, string | number | boolean>;
}

/** Public, PII-free projection of a House + its current CandyParticipation, for the public map. */
export interface PublicHousePin {
  id: string;
  point: GeoPoint;
  status: CandyStatus;
  updatedAt: string;
}
