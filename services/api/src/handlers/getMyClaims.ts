/**
 * GET /me/claims
 * Authenticated. Returns the signed-in user's own claims (any status) via the gsi1 "claims by
 * user" access pattern. Private endpoint — full claim detail is fine here since it's the user's
 * own data.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { CandyParticipation, House, HouseClaim, MyHouseClaim, Neighborhood } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getCurrentSeasonId, getTableName, houseParticipationKey, houseKey, neighborhoodKey } from "../lib/table.js";
import { getEventEdition } from "@candy-map/shared";
import { readEventParticipation } from "../lib/eventParticipation.js";
import { getHouseAccess, type HouseMember } from "../lib/houseAccess.js";
import { isHouseBlocked } from "../lib/privacy.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return errorResponse(401, "Sign-in required.");
  }
  const eventId = event.queryStringParameters?.eventId;
  const edition = eventId !== undefined ? getEventEdition(eventId) : undefined;
  if (eventId !== undefined && !edition) return errorResponse(400, "Unsupported event edition.");

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
  if (edition) {
    const memberResults = await ddbDocClient.send(new QueryCommand({
      TableName: tableName, IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :user AND begins_with(gsi1sk, :prefix)",
      ExpressionAttributeValues: { ":user": `USER#${userId}`, ":prefix": "MEMBER#" },
    }));
    const members = (memberResults.Items ?? []) as HouseMember[];
    const eligibleMembers = members.filter((member) =>
      member.state === "active" && (!member.eventId || member.eventId === edition.id)
      && !claims.some((claim) => claim.houseId === member.houseId && claim.status === "approved"));
    const invited: MyHouseClaim[] = eligibleMembers.filter((member, index) =>
      eligibleMembers.findIndex((item) => item.houseId === member.houseId) === index)
      .map((member) => ({
        houseId: member.houseId, userId, status: "approved", verificationLevel: "self_reported",
        createdAt: member.createdAt, updatedAt: member.createdAt, participation: null,
        accessRole: member.role, accessSource: "membership",
      }));
    const combined: MyHouseClaim[] = [...claims.filter((claim) => !invited.some((member) => member.houseId === claim.houseId)).map((claim) => ({ ...claim, participation: null })), ...invited];
    const response = await Promise.all(combined.map(async (claim): Promise<MyHouseClaim | null> => {
      const access = claim.status === "approved" ? await getHouseAccess(tableName, claim.houseId, userId, edition.id) : undefined;
      if (claim.status === "approved" && !access) return null;
      const result = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(claim.houseId), ConsistentRead: true }));
      const house = result.Item as House | undefined;
      const neighborhood = house ? await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: neighborhoodKey(house.neighborhoodId) })) : undefined;
      const name = (neighborhood?.Item as Neighborhood | undefined)?.name;
      return {
        ...claim, participation: null, accessSource: access?.source ?? "claim",
        accessRole: access?.role,
        houseLabel: claim.status === "approved" ? house?.addressDisplayPrivate ?? "House awaiting address review" : "House claim awaiting approval", neighborhoodName: name,
        blocked: house ? await isHouseBlocked(tableName, house) : false,
        eventParticipation: await readEventParticipation(tableName, claim.houseId, edition) ?? null,
      };
    }));
    return jsonResponse(200, response.filter((claim): claim is MyHouseClaim => claim !== null));
  }
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
