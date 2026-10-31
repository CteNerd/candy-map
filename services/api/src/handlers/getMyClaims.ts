/**
 * GET /me/claims
 * Authenticated. Returns the signed-in user's own claims (any status) via the gsi1 "claims by
 * user" access pattern. Private endpoint — full claim detail is fine here since it's the user's
 * own data.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName } from "../lib/table.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return errorResponse(401, "Sign-in required.");
  }

  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :user AND begins_with(gsi1sk, :claimPrefix)",
      ExpressionAttributeValues: { ":user": `USER#${userId}`, ":claimPrefix": "CLAIM#" },
    }),
  );

  return jsonResponse(200, result.Items ?? []);
}
