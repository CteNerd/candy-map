/**
 * POST /houses/resolve
 * Authenticated. Resolves a street address to a canonical House, creating it if this is the
 * first time anyone has reported it. Enforces:
 *  - the point must fall inside the target neighborhood's polygon (plan: "An address outside the
 *    polygon cannot be registered in that neighborhood")
 *  - "Repeated house submissions resolve to one canonical house" via a `HOUSE_KEY#<hash>`
 *    reservation item written atomically with the House item (`TransactWriteItems`); a race
 *    between two simultaneous submissions is resolved by re-reading the winning house rather than
 *    erroring or creating a duplicate.
 *
 * Google Places assists address selection in the UI, but the caller still supplies `point`
 * directly. This endpoint does not verify the address or ownership; see README limitations.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { canonicalAddressKey, isPointInPolygon } from "@candy-map/shared";
import type { GeoPoint, House, Neighborhood } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName, houseGsi1, houseKey, houseKeyReservationKey, neighborhoodKey } from "../lib/table.js";

interface ResolveHouseRequestBody {
  neighborhoodId: string;
  street: string;
  unit?: string;
  postalCode: string;
  country: string;
  point: GeoPoint;
  providerAddressId?: string;
}

function parseBody(event: APIGatewayProxyEventV2): ResolveHouseRequestBody | null {
  if (!event.body) return null;
  try {
    const parsed = JSON.parse(event.body) as Partial<ResolveHouseRequestBody>;
    if (
      !parsed.neighborhoodId ||
      !parsed.street ||
      !parsed.postalCode ||
      !parsed.country ||
      typeof parsed.point?.lat !== "number" ||
      typeof parsed.point?.lon !== "number"
    ) {
      return null;
    }
    return parsed as ResolveHouseRequestBody;
  } catch {
    return null;
  }
}

async function fetchHouseById(tableName: string, houseId: string): Promise<House | undefined> {
  const result = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(houseId) }));
  return result.Item as House | undefined;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return errorResponse(401, "Sign-in required.");
  }

  const body = parseBody(event);
  if (!body) {
    return errorResponse(400, "Request body must include neighborhoodId, street, postalCode, country, and point.");
  }

  const tableName = getTableName();

  const neighborhoodResult = await ddbDocClient.send(
    new GetCommand({ TableName: tableName, Key: neighborhoodKey(body.neighborhoodId) }),
  );
  const neighborhood = neighborhoodResult.Item as Neighborhood | undefined;
  if (!neighborhood) {
    return errorResponse(404, "Neighborhood not found.");
  }

  if (!isPointInPolygon(body.point, neighborhood.polygon)) {
    return errorResponse(422, "This address falls outside the neighborhood's boundary.");
  }

  const addressKey = canonicalAddressKey(body);
  const reservationKey = houseKeyReservationKey(addressKey);

  const existingReservation = await ddbDocClient.send(
    new GetCommand({ TableName: tableName, Key: reservationKey }),
  );
  if (existingReservation.Item) {
    const existingHouse = await fetchHouseById(tableName, existingReservation.Item.houseId as string);
    return jsonResponse(200, { house: existingHouse, created: false });
  }

  const houseId = generateId();
  const house: House = {
    id: houseId,
    canonicalAddressKey: addressKey,
    addressDisplayPrivate: [body.street, body.unit].filter(Boolean).join(", "),
    point: body.point,
    neighborhoodId: body.neighborhoodId,
    visibility: "public",
    createdAt: new Date().toISOString(),
  };

  try {
    await ddbDocClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: { ...reservationKey, houseId },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: { ...houseKey(houseId), ...house, ...houseGsi1(body.neighborhoodId, houseId) },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        ],
      }),
    );
    return jsonResponse(201, { house, created: true });
  } catch (err) {
    // Lost the race to a concurrent resolve of the same address — return the winner's house
    // rather than erroring, per "Repeated house submissions resolve to one canonical house."
    if ((err as { name?: string }).name === "TransactionCanceledException") {
      const reservation = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: reservationKey }));
      if (reservation.Item) {
        const winningHouse = await fetchHouseById(tableName, reservation.Item.houseId as string);
        return jsonResponse(200, { house: winningHouse, created: false });
      }
    }
    throw err;
  }
}
