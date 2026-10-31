/**
 * GET /neighborhoods?lat=&lon=
 * Public, unauthenticated. Returns neighborhoods that contain the point (first) and nearby ones
 * (within NEARBY_RADIUS_METERS of the centroid), as PII-free `PublicNeighborhood` projections.
 *
 * Scans the table for active neighborhoods — acceptable for this single-region POC per
 * COPILOT_PLAN.md ("POC may scan one small regional set"). Replace with a geohash/S2 GSI query
 * before scaling to many neighborhoods/regions.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import * as turf from "@turf/turf";
import { isPointInPolygon, toPublicNeighborhood } from "@candy-map/shared";
import type { Neighborhood } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName } from "../lib/table.js";

const NEARBY_RADIUS_METERS = 3000;
const MAX_RESULTS = 20;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const latParam = event.queryStringParameters?.lat;
  const lonParam = event.queryStringParameters?.lon;
  const lat = latParam ? Number.parseFloat(latParam) : NaN;
  const lon = lonParam ? Number.parseFloat(lonParam) : NaN;

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return errorResponse(400, "Query parameters 'lat' and 'lon' are required and must be numbers.");
  }

  const result = await ddbDocClient.send(
    new ScanCommand({
      TableName: getTableName(),
      FilterExpression: "begins_with(pk, :nbhdPrefix) AND sk = :metadata AND #status = :active",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":nbhdPrefix": "NEIGHBORHOOD#",
        ":metadata": "METADATA",
        ":active": "active",
      },
    }),
  );

  const neighborhoods = (result.Items ?? []) as Neighborhood[];
  const point = turf.point([lon, lat]);

  const containing: Neighborhood[] = [];
  const nearby: Neighborhood[] = [];

  for (const neighborhood of neighborhoods) {
    if (isPointInPolygon({ lat, lon }, neighborhood.polygon)) {
      containing.push(neighborhood);
      continue;
    }
    const centroidPoint = turf.point([neighborhood.centroid.lon, neighborhood.centroid.lat]);
    const distanceMeters = turf.distance(point, centroidPoint, { units: "meters" });
    if (distanceMeters <= NEARBY_RADIUS_METERS) {
      nearby.push(neighborhood);
    }
  }

  const combined = [...containing, ...nearby].slice(0, MAX_RESULTS).map(toPublicNeighborhood);
  return jsonResponse(200, combined);
}
