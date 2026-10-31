/**
 * POST /neighborhoods
 * Authenticated — any signed-in user may propose a neighborhood, becoming its first organizer
 * (an active `NeighborhoodMembership` is created alongside it). Enforces structural polygon
 * validation (closed, non-self-intersecting, reasonable area, inside the supported region) via
 * `packages/shared`.
 *
 * Deliberately does NOT do duplicate/overlap detection yet — that lands in Milestone 4 alongside
 * the spatial creation-reservation lock. Until then this endpoint can create overlapping
 * neighborhoods; see TASKS.md Milestone 4 and README "Known limitations".
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { computeBoundingBox, computeCentroid, validatePolygon } from "@candy-map/shared";
import type { Neighborhood, PolygonGeoJSON } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName, neighborhoodKey, neighborhoodMembershipKey } from "../lib/table.js";

interface CreateNeighborhoodRequestBody {
  name: string;
  polygon: PolygonGeoJSON;
}

function parseBody(event: APIGatewayProxyEventV2): CreateNeighborhoodRequestBody | null {
  if (!event.body) return null;
  try {
    const parsed = JSON.parse(event.body) as Partial<CreateNeighborhoodRequestBody>;
    if (!parsed.name?.trim() || parsed.polygon?.type !== "Polygon" || !Array.isArray(parsed.polygon.coordinates)) {
      return null;
    }
    return parsed as CreateNeighborhoodRequestBody;
  } catch {
    return null;
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return errorResponse(401, "Sign-in required.");
  }

  const body = parseBody(event);
  if (!body) {
    return errorResponse(400, "Request body must include 'name' and a GeoJSON 'polygon'.");
  }

  const validation = validatePolygon(body.polygon);
  if (!validation.valid) {
    return errorResponse(422, "Invalid neighborhood boundary.", validation.errors);
  }

  const neighborhoodId = generateId();
  const neighborhood: Neighborhood = {
    id: neighborhoodId,
    name: body.name.trim(),
    normalizedName: body.name.trim().toLowerCase(),
    polygon: body.polygon,
    bbox: computeBoundingBox(body.polygon),
    centroid: computeCentroid(body.polygon),
    status: "active",
    organizerIds: [userId],
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };

  const tableName = getTableName();
  await ddbDocClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: { ...neighborhoodKey(neighborhoodId), ...neighborhood },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              ...neighborhoodMembershipKey(neighborhoodId, userId),
              neighborhoodId,
              userId,
              role: "organizer",
              state: "active",
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
      ],
    }),
  );

  return jsonResponse(201, neighborhood);
}
