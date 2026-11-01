import { GetCommand, ScanCommand, QueryCommand, TransactWriteCommand, type ScanCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import type { House, HouseClaim, Neighborhood } from "@candy-map/shared";
import { toPublicNeighborhood } from "@candy-map/shared";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { isActiveOrganizer } from "../lib/authz.js";
import { ddbDocClient } from "../lib/ddb.js";
import { getTableName, neighborhoodKey, neighborhoodMembershipKey } from "../lib/table.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return errorResponse(401, "Sign-in required.");
  const tableName = getTableName();
  if (event.routeKey === "GET /me/neighborhoods") {
    const neighborhoods: Neighborhood[] = [];
    let cursor: ScanCommandOutput["LastEvaluatedKey"];
    do {
      const result = await ddbDocClient.send(new ScanCommand({
        TableName: tableName, ExclusiveStartKey: cursor,
        FilterExpression: "begins_with(pk, :prefix) AND sk = :metadata AND contains(organizerIds, :user)",
        ExpressionAttributeValues: { ":prefix": "NEIGHBORHOOD#", ":metadata": "METADATA", ":user": userId },
      }));
      neighborhoods.push(...(result.Items ?? []) as Neighborhood[]);
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    const access = await Promise.all(neighborhoods.map((neighborhood) => isActiveOrganizer(tableName, neighborhood.id, userId)));
    return jsonResponse(200, neighborhoods.filter((_, index) => access[index]).map(toPublicNeighborhood));
  }
  const neighborhoodId = event.pathParameters?.id;
  if (!neighborhoodId) return errorResponse(400, "Choose a neighborhood.");
  if (!await isActiveOrganizer(tableName, neighborhoodId, userId)) return errorResponse(403, "Neighborhood organizer access required.");
  if (event.routeKey === "GET /neighborhoods/{id}/claims") {
    const houseResults = await ddbDocClient.send(new QueryCommand({
      TableName: tableName, IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :neighborhood AND begins_with(gsi1sk, :prefix)",
      ExpressionAttributeValues: { ":neighborhood": `NEIGHBORHOOD#${neighborhoodId}`, ":prefix": "HOUSE#" },
    }));
    const claims = await Promise.all((houseResults.Items ?? []).map(async (item) => {
      const house = item as House;
      const result = await ddbDocClient.send(new QueryCommand({
        TableName: tableName, KeyConditionExpression: "pk = :house AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":house": `HOUSE#${house.id}`, ":prefix": "CLAIM#" }, ConsistentRead: true,
      }));
      return ((result.Items ?? []) as HouseClaim[]).filter((claim) => claim.status === "pending" || claim.status === "disputed").map((claim) => ({
        claimKey: `${claim.houseId}::${claim.userId}`, houseLabel: house.addressDisplayPrivate,
        status: claim.status, createdAt: claim.createdAt,
      }));
    }));
    return jsonResponse(200, claims.flat());
  }
  let body: unknown;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return errorResponse(400, "Request body must be valid JSON."); }
  if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string"
    || !body.name.trim() || body.name.trim().length > 120) return errorResponse(400, "A neighborhood name of 1-120 characters is required.");
  const Key = neighborhoodKey(neighborhoodId);
  const result = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key, ConsistentRead: true }));
  const neighborhood = result.Item as Neighborhood | undefined;
  if (!neighborhood) return errorResponse(404, "Neighborhood not found.");
  const updated = { ...neighborhood, name: body.name.trim(), normalizedName: body.name.trim().toLowerCase().replace(/\s+/g, " ") };
  try {
    await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: tableName, Key: neighborhoodMembershipKey(neighborhoodId, userId),
        ConditionExpression: "#state = :active AND #role = :organizer",
        ExpressionAttributeNames: { "#state": "state", "#role": "role" }, ExpressionAttributeValues: { ":active": "active", ":organizer": "organizer" } } },
      { Put: { TableName: tableName, Item: { ...result.Item, ...updated },
        ConditionExpression: "#name = :old", ExpressionAttributeNames: { "#name": "name" }, ExpressionAttributeValues: { ":old": neighborhood.name } } },
    ] }));
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse(409, "Neighborhood name or permissions changed. Reload before saving.");
    throw error;
  }
  return jsonResponse(200, toPublicNeighborhood(updated));
}
