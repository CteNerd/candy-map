/**
 * POST /neighborhoods
 * Authenticated — any signed-in user may propose a neighborhood, becoming its first organizer
 * (an active `NeighborhoodMembership` is created alongside it). Enforces:
 *  - structural polygon validation (closed, non-self-intersecting, reasonable area, inside the
 *    supported region) via `packages/shared`
 *  - duplicate/overlap prevention: >=0.8 overlap (either direction) blocks creation outright and
 *    points at the existing neighborhood; >=0.1 still creates it, but as `pending_review` rather
 *    than `active` (no auto-merge — an organizer reviews it later; see TASKS.md Milestone 4 for
 *    the still-missing review-queue *listing* endpoint)
 *  - a short-lived spatial lock (single grid cell, POC-scale — see lib/neighborhoodLock.ts) so two
 *    concurrent creations of the same area can't both pass the overlap check
 *
 * Candidate search scans the table rather than using a geohash GSI — "POC may scan one small
 * regional set" per COPILOT_PLAN.md. Replace with a real geohash/S2 index before scaling.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  boundingBoxesOverlap,
  classifyOverlap,
  computeBoundingBox,
  computeCentroid,
  computePolygonOverlap,
  gridCellId,
  validatePolygon,
} from "@candy-map/shared";
import type { Neighborhood, PolygonGeoJSON } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";
import { acquireNeighborhoodLockWithRetry } from "../lib/neighborhoodLock.js";
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

async function findOverlappingNeighborhoods(
  tableName: string,
  proposedBbox: ReturnType<typeof computeBoundingBox>,
  proposedPolygon: PolygonGeoJSON,
) {
  const result = await ddbDocClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "begins_with(pk, :nbhdPrefix) AND sk = :metadata AND #status <> :archived",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":nbhdPrefix": "NEIGHBORHOOD#",
        ":metadata": "METADATA",
        ":archived": "archived",
      },
    }),
  );
  const candidates = (result.Items ?? []) as Neighborhood[];

  let blocked: Neighborhood | undefined;
  let review: Neighborhood | undefined;
  for (const candidate of candidates) {
    if (!boundingBoxesOverlap(proposedBbox, candidate.bbox)) continue;
    const overlap = computePolygonOverlap(proposedPolygon, candidate.polygon);
    const verdict = classifyOverlap(overlap);
    if (verdict === "blocked") {
      blocked = candidate;
      break;
    }
    if (verdict === "review" && !review) {
      review = candidate;
    }
  }
  return { blocked, review };
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

  const tableName = getTableName();
  const bbox = computeBoundingBox(body.polygon);
  const centroid = computeCentroid(body.polygon);
  const cellId = gridCellId(centroid);

  const lockAcquired = await acquireNeighborhoodLockWithRetry(tableName, cellId);
  if (!lockAcquired) {
    return errorResponse(409, "Another neighborhood is being created nearby right now — please try again shortly.");
  }

  // Re-check candidates inside the critical section the lock protects.
  const { blocked, review } = await findOverlappingNeighborhoods(tableName, bbox, body.polygon);
  if (blocked) {
    return errorResponse(409, "This boundary overlaps an existing neighborhood too closely — join it instead.", [
      `existingNeighborhoodId:${blocked.id}`,
    ]);
  }

  const neighborhoodId = generateId();
  const neighborhood: Neighborhood = {
    id: neighborhoodId,
    name: body.name.trim(),
    normalizedName: body.name.trim().toLowerCase(),
    polygon: body.polygon,
    bbox,
    centroid,
    status: review ? "pending_review" : "active",
    organizerIds: [userId],
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };

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
