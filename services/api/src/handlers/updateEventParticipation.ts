import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { getEventEdition, getEventLifecycle } from "@candy-map/shared";
import type { EventParticipation, EventStatus, House } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName, houseKey, houseEventParticipationKey } from "../lib/table.js";
import { getHouseAccess } from "../lib/houseAccess.js";
import { isHouseBlocked, publicationPrivacyConditions } from "../lib/privacy.js";
import { readEventParticipation } from "../lib/eventParticipation.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return errorResponse(401, "Sign-in required.");
  const houseId = event.pathParameters?.id;
  const edition = getEventEdition(event.pathParameters?.eventId ?? "");
  if (!houseId || !edition) return errorResponse(400, "A house and supported event edition are required.");
  if (getEventLifecycle(edition) === "past") return errorResponse(409, "This event has ended.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || !("status" in parsed) || typeof parsed.status !== "string"
    || !edition.statuses.some((status) => status === parsed.status)
    || !("publicOptIn" in parsed) || typeof parsed.publicOptIn !== "boolean") {
    return errorResponse(400, "A valid event status and explicit publicOptIn boolean are required.");
  }
  const tableName = getTableName();
  const [houseResult, access] = await Promise.all([
    ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(houseId), ConsistentRead: true })),
    getHouseAccess(tableName, houseId, userId, edition.id),
  ]);
  const house = houseResult.Item as House | undefined;
  if (!house) return errorResponse(404, "House not found.");
  // Organizing a neighborhood alone does not grant resident publication permission.
  if (!access) {
    return errorResponse(403, "An approved claim for this house is required.");
  }
  if (await isHouseBlocked(tableName, house)) return errorResponse(409, "This property is unavailable for updates while a privacy hold is active.");
  const saved = await readEventParticipation(tableName, houseId, edition);
  if (access.role === "editor") {
    if (!saved || saved.publicOptIn !== parsed.publicOptIn) return errorResponse(403, "Only a house manager can change publication permission.");
  }
  if (house.visibility !== "public" && parsed.publicOptIn) {
    return errorResponse(409, "This house is not available for publication.");
  }
  const now = new Date();
  const expiresAt = edition.type === "halloween" && getEventLifecycle(edition, now) === "active"
    ? new Date(Math.min(now.getTime() + 6 * 3600_000, Date.parse(edition.endsAt))).toISOString()
    : edition.endsAt;
  const participation: EventParticipation = {
    houseId, eventId: edition.id, status: parsed.status as EventStatus,
    publicOptIn: parsed.publicOptIn, updatedAt: now.toISOString(), expiresAt,
  };
  try {
    await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [
      access.condition, ...publicationPrivacyConditions(tableName, house),
      { Put: { TableName: tableName, Item: { ...houseEventParticipationKey(houseId, edition.id), ...participation },
        ...(access.role === "editor" ? {
          ConditionExpression: "publicOptIn = :permission AND updatedAt = :version",
          ExpressionAttributeValues: { ":permission": saved?.publicOptIn, ":version": saved?.updatedAt },
        } : {}) } },
    ] }));
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse(409, "House permissions or privacy changed. Reload before saving.");
    throw error;
  }
  return jsonResponse(200, participation);
}
