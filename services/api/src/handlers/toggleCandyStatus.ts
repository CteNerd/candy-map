/**
 * PATCH /houses/{id}/candy
 * Authenticated. Updates this season's CandyParticipation status for a house. Authorization is
 * enforced server-side via `canModifyCandyStatus` (shared): only an organizer of the house's
 * neighborhood, or the house's *approved* claimant, may change it — "An unapproved account cannot
 * change another house's status."
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { canModifyCandyStatus } from "@candy-map/shared";
import type { CandyParticipation, CandyStatus, House, HouseClaim } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { isActiveOrganizer } from "../lib/authz.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getCurrentSeasonId, getTableName, houseClaimKey, houseKey, houseParticipationKey } from "../lib/table.js";
import { isHouseBlocked, publicationPrivacyConditions } from "../lib/privacy.js";

const VALID_STATUSES: CandyStatus[] = ["available", "low", "finished"];
const DEFAULT_PARTICIPATION_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours — a typical trick-or-treat evening window

interface ToggleCandyRequestBody {
  status: CandyStatus;
  publicOptIn?: boolean;
  expiresAt?: string;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return errorResponse(401, "Sign-in required.");
  }

  const houseId = event.pathParameters?.id;
  if (!houseId) {
    return errorResponse(400, "Path parameter 'id' is required.");
  }

  let body: ToggleCandyRequestBody;
  try {
    body = event.body ? (JSON.parse(event.body) as ToggleCandyRequestBody) : ({} as ToggleCandyRequestBody);
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return errorResponse(400, `'status' must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const tableName = getTableName();
  const houseResult = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(houseId) }));
  const house = houseResult.Item as House | undefined;
  if (!house) {
    return errorResponse(404, "House not found.");
  }
  if (await isHouseBlocked(tableName, house)) return errorResponse(409, "This property is unavailable for updates.");

  const [claimResult, organizer] = await Promise.all([
    ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseClaimKey(houseId, userId) })),
    isActiveOrganizer(tableName, house.neighborhoodId, userId),
  ]);
  const ownClaim = claimResult.Item as HouseClaim | undefined;

  const actor = { userId, organizerOfNeighborhoodIds: organizer ? [house.neighborhoodId] : [] };
  if (!canModifyCandyStatus(actor, house, ownClaim)) {
    return errorResponse(403, "You are not authorized to update this house's candy status.");
  }

  const now = new Date().toISOString();
  const participation: CandyParticipation = {
    houseId,
    seasonId: getCurrentSeasonId(),
    status: body.status,
    updatedAt: now,
    expiresAt: body.expiresAt ?? new Date(Date.now() + DEFAULT_PARTICIPATION_WINDOW_MS).toISOString(),
    publicOptIn: body.publicOptIn ?? true,
  };

  await ddbDocClient.send(
    new TransactWriteCommand({ TransactItems: [
      ...publicationPrivacyConditions(tableName, house),
      { Put: { TableName: tableName, Item: { ...houseParticipationKey(houseId, participation.seasonId), ...participation } } },
    ] }),
  );

  return jsonResponse(200, participation);
}
