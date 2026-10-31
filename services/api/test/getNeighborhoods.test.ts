import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/getNeighborhoods.js";
import type { Neighborhood } from "@candy-map/shared";

const ddbMock = mockClient(ddbDocClient);

function square(minLon: number, minLat: number, maxLon: number, maxLat: number) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

const CONTAINING: Neighborhood = {
  id: "n-containing",
  name: "Containing Neighborhood",
  normalizedName: "containing neighborhood",
  polygon: square(-122.42, 37.77, -122.41, 37.78),
  bbox: { minLon: -122.42, minLat: 37.77, maxLon: -122.41, maxLat: 37.78 },
  centroid: { lat: 37.775, lon: -122.415 },
  status: "active",
  organizerIds: ["organizer-secret-id"],
  createdBy: "organizer-secret-id",
  createdAt: "2024-01-01T00:00:00.000Z",
};

const FAR_AWAY: Neighborhood = {
  ...CONTAINING,
  id: "n-far",
  name: "Far Away Neighborhood",
  polygon: square(10, 10, 11, 11),
  bbox: { minLon: 10, minLat: 10, maxLon: 11, maxLat: 11 },
  centroid: { lat: 10.5, lon: 10.5 },
};

function makeEvent(query: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    queryStringParameters: query,
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
});

describe("getNeighborhoods handler", () => {
  it("returns 400 when lat/lon are missing", async () => {
    const result = (await handler(makeEvent({}))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("returns a containing neighborhood as a PII-free projection", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [CONTAINING, FAR_AWAY] });

    const result = (await handler(makeEvent({ lat: "37.775", lon: "-122.415" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("n-containing");
    expect(body[0]).not.toHaveProperty("organizerIds");
    expect(body[0]).not.toHaveProperty("createdBy");
  });

  it("excludes neighborhoods far from the point", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [FAR_AWAY] });

    const result = (await handler(makeEvent({ lat: "37.775", lon: "-122.415" }))) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body!);
    expect(body).toHaveLength(0);
  });
});
