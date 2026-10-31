/**
 * GET /me/claims
 * Authenticated. Returns the signed-in user's own claims (any status) via the gsi1 "claims by
 * user" access pattern. Private endpoint — full claim detail is fine here since it's the user's
 * own data.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { CandyParticipation, HouseClaim, MyHouseClaim } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getCurrentSeasonId, getTableName, houseParticipationKey } from "../lib/table.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return errorResponse(401, "Sign-in required.");
  }

  const tableName = getTableName();
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :user AND begins_with(gsi1sk, :claimPrefix)",
      ExpressionAttributeValues: { ":user": `USER#${userId}`, ":claimPrefix": "CLAIM#" },
    }),
  );

  const claims = (result.Items ?? []) as HouseClaim[];
  const seasonId = getCurrentSeasonId();
  const response: MyHouseClaim[] = await Promise.all(claims.map(async (claim) => {
    const result = await ddbDocClient.send(new GetCommand({
      TableName: tableName,
      Key: houseParticipationKey(claim.houseId, seasonId),
      ConsistentRead: true,
    }));
    const item = result.Item as CandyParticipation | undefined;
    return {
      ...claim,
      participation: item ? {
        houseId: item.houseId, seasonId: item.seasonId, status: item.status,
        updatedAt: item.updatedAt, expiresAt: item.expiresAt, publicOptIn: item.publicOptIn,
      } : null,
    };
  }));
  return jsonResponse(200, response);
}
