/**
 * POST /admin/claims/{id}/approve
 * Authenticated organizer only. `{id}` is `<houseId>::<claimantUserId>` (claims are keyed by that
 * composite pair rather than a standalone id — see services/api/src/lib/table.ts).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { canApproveClaim } from "@candy-map/shared";
import type { House, HouseClaim } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { isActiveOrganizer } from "../lib/authz.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { claimGsi1, getTableName, houseClaimKey, houseKey } from "../lib/table.js";

function parseClaimId(claimId: string): { houseId: string; claimantUserId: string } | null {
  const [houseId, claimantUserId] = claimId.split("::");
  if (!houseId || !claimantUserId) return null;
  return { houseId, claimantUserId };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const actorUserId = getAuthenticatedUserId(event);
  if (!actorUserId) {
    return errorResponse(401, "Sign-in required.");
  }

  const claimId = event.pathParameters?.id;
  const parsed = claimId ? parseClaimId(claimId) : null;
  if (!parsed) {
    return errorResponse(400, "Path parameter 'id' must be '<houseId>::<claimantUserId>'.");
  }
  const { houseId, claimantUserId } = parsed;

  const tableName = getTableName();
  const houseResult = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(houseId) }));
  const house = houseResult.Item as House | undefined;
  if (!house) {
    return errorResponse(404, "House not found.");
  }

  const organizer = await isActiveOrganizer(tableName, house.neighborhoodId, actorUserId);
  if (!canApproveClaim({ userId: actorUserId, organizerOfNeighborhoodIds: organizer ? [house.neighborhoodId] : [] }, house)) {
    return errorResponse(403, "Only an organizer of this neighborhood may approve claims.");
  }

  const claimResult = await ddbDocClient.send(
    new GetCommand({ TableName: tableName, Key: houseClaimKey(houseId, claimantUserId) }),
  );
  const existingClaim = claimResult.Item as HouseClaim | undefined;
  if (!existingClaim) {
    return errorResponse(404, "Claim not found.");
  }

  const approvedClaim: HouseClaim = {
    ...existingClaim,
    status: "approved",
    verificationLevel: "organizer_approved",
    updatedAt: new Date().toISOString(),
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: tableName,
      Item: { ...houseClaimKey(houseId, claimantUserId), ...approvedClaim, ...claimGsi1(claimantUserId, houseId) },
    }),
  );

  return jsonResponse(200, approvedClaim);
}
