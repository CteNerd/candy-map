/**
 * GET /neighborhoods/{id}/houses
 * Public, unauthenticated. Returns only opted-in, publicly-visible, non-expired, non-finished
 * candy pins for the given neighborhood — no address, claimant, or other PII, per
 * COPILOT_PLAN.md "Public APIs must never return resident name, email, user ID, or claim details."
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { isPubliclyVisible } from "@candy-map/shared";
import type { CandyParticipation, House, PublicHousePin } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getCurrentSeasonId, getTableName, houseParticipationKey } from "../lib/table.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const neighborhoodId = event.pathParameters?.id;
  if (!neighborhoodId) {
    return errorResponse(400, "Path parameter 'id' is required.");
  }

  const tableName = getTableName();
  const housesResult = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :nbhd AND begins_with(gsi1sk, :housePrefix)",
      ExpressionAttributeValues: {
        ":nbhd": `NEIGHBORHOOD#${neighborhoodId}`,
        ":housePrefix": "HOUSE#",
      },
    }),
  );
  const houses = (housesResult.Items ?? []) as House[];
  const publicHouses = houses.filter((house) => house.visibility === "public");

  const seasonId = getCurrentSeasonId();
  const participations = await Promise.all(
    publicHouses.map((house) =>
      ddbDocClient.send(
        new GetCommand({ TableName: tableName, Key: houseParticipationKey(house.id, seasonId) }),
      ),
    ),
  );

  const pins: PublicHousePin[] = [];
  publicHouses.forEach((house, index) => {
    const participation = participations[index]?.Item as CandyParticipation | undefined;
    if (!participation || !isPubliclyVisible(participation)) return;
    pins.push({
      id: house.id,
      point: house.point,
      status: participation.status,
      updatedAt: participation.updatedAt,
    });
  });

  return jsonResponse(200, pins);
}
