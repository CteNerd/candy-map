/**
 * POST /houses/claims
 * Authenticated. Submits a self-reported claim on a house. Per COPILOT_PLAN.md: "House claim
 * requests never silently replace an existing claimant" — if someone else already has an
 * approved claim, the new submission is recorded as `disputed`, not auto-approved or silently
 * dropped, and organizer review (approveClaim handler) resolves it.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { canSubmitClaim } from "@candy-map/shared";
import type { HouseClaim } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { claimGsi1, getTableName, houseClaimKey, houseKey } from "../lib/table.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return errorResponse(401, "Sign-in required.");
  }

  let houseId: string | undefined;
  try {
    houseId = event.body ? (JSON.parse(event.body) as { houseId?: string }).houseId : undefined;
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }
  if (!houseId) {
    return errorResponse(400, "Request body must include houseId.");
  }

  const tableName = getTableName();
  const houseResult = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(houseId) }));
  if (!houseResult.Item) {
    return errorResponse(404, "House not found.");
  }

  const existingClaimsResult = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :house AND begins_with(sk, :claimPrefix)",
      ExpressionAttributeValues: { ":house": houseKey(houseId).pk, ":claimPrefix": "CLAIM#" },
    }),
  );
  const existingClaims = (existingClaimsResult.Items ?? []) as HouseClaim[];

  const ownClaim = existingClaims.find((claim) => claim.userId === userId);
  if (ownClaim?.status === "approved") {
    return jsonResponse(200, ownClaim);
  }

  const otherApprovedClaim = existingClaims.find((claim) => claim.status === "approved" && claim.userId !== userId);
  const { resultingStatus } = canSubmitClaim(otherApprovedClaim);

  const now = new Date().toISOString();
  const claim: HouseClaim = {
    houseId,
    userId,
    verificationLevel: "self_reported",
    status: resultingStatus,
    createdAt: ownClaim?.createdAt ?? now,
    updatedAt: now,
  };

  await ddbDocClient.send(
    new PutCommand({
      TableName: tableName,
      Item: { ...houseClaimKey(houseId, userId), ...claim, ...claimGsi1(userId, houseId) },
    }),
  );

  return jsonResponse(ownClaim ? 200 : 201, claim);
}
