import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/resolveHouse.js";
import { houseKey, houseKeyReservationKey, neighborhoodKey } from "../src/lib/table.js";
import type { Neighborhood } from "@candy-map/shared";
import { canonicalAddressKey } from "@candy-map/shared";

const ddbMock = mockClient(ddbDocClient);

const NEIGHBORHOOD: Neighborhood = {
  id: "n1",
  name: "Maple Hollow",
  normalizedName: "maple hollow",
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [-122.42, 37.77],
        [-122.41, 37.77],
        [-122.41, 37.78],
        [-122.42, 37.78],
        [-122.42, 37.77],
      ],
    ],
  },
  bbox: { minLon: -122.42, minLat: 37.77, maxLon: -122.41, maxLat: 37.78 },
  centroid: { lat: 37.775, lon: -122.415 },
  status: "active",
  organizerIds: ["organizer-1"],
  createdBy: "organizer-1",
  createdAt: "2024-01-01T00:00:00.000Z",
};

const REQUEST_BODY = {
  neighborhoodId: "n1",
  street: "123 Main St",
  postalCode: "94110",
  country: "us",
  point: { lat: 37.775, lon: -122.415 },
};

function makeEvent(body: unknown, authenticated = true): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    requestContext: authenticated
      ? { authorizer: { jwt: { claims: { sub: "resident-1" } } } }
      : {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({});
  process.env.TABLE_NAME = "test-table";
});

describe("resolveHouse handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(makeEvent(REQUEST_BODY, false))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("returns 422 when the point is outside the neighborhood polygon", async () => {
    ddbMock.on(GetCommand, { Key: neighborhoodKey("n1") }).resolves({ Item: NEIGHBORHOOD });
    const result = (await handler(
      makeEvent({ ...REQUEST_BODY, point: { lat: 10, lon: 10 } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(422);
  });

  it("creates a new house via TransactWriteItems when none exists yet", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined }); // reservation lookup: nothing yet
    ddbMock.on(GetCommand, { Key: neighborhoodKey("n1") }).resolves({ Item: NEIGHBORHOOD });
    ddbMock.on(TransactWriteCommand).resolves({});

    const result = (await handler(makeEvent(REQUEST_BODY))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body.created).toBe(true);
    expect(body.house.neighborhoodId).toBe("n1");
  });

  it("returns the existing canonical house instead of creating a duplicate", async () => {
    const addressKey = canonicalAddressKey(REQUEST_BODY);
    ddbMock.on(GetCommand, { Key: neighborhoodKey("n1") }).resolves({ Item: NEIGHBORHOOD });
    ddbMock
      .on(GetCommand, { Key: houseKeyReservationKey(addressKey) })
      .resolves({ Item: { ...houseKeyReservationKey(addressKey), houseId: "existing-house-id" } });
    ddbMock
      .on(GetCommand, { Key: houseKey("existing-house-id") })
      .resolves({ Item: { id: "existing-house-id", neighborhoodId: "n1" } });

    const result = (await handler(makeEvent(REQUEST_BODY))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.created).toBe(false);
    expect(body.house.id).toBe("existing-house-id");
  });

  it("resolves a concurrent-creation race to the winning house rather than erroring", async () => {
    const addressKey = canonicalAddressKey(REQUEST_BODY);
    ddbMock.on(GetCommand, { Key: neighborhoodKey("n1") }).resolves({ Item: NEIGHBORHOOD });

    // First reservation lookup: nothing yet (so the handler attempts to create).
    ddbMock.on(GetCommand, { Key: houseKeyReservationKey(addressKey) }).resolvesOnce({ Item: undefined });

    const raceError = new Error("Transaction cancelled");
    raceError.name = "TransactionCanceledException";
    ddbMock.on(TransactWriteCommand).rejects(raceError);

    // Re-check after the race loses: the other request's reservation is now visible.
    ddbMock
      .on(GetCommand, { Key: houseKeyReservationKey(addressKey) })
      .resolvesOnce({ Item: { ...houseKeyReservationKey(addressKey), houseId: "winner-house-id" } });
    ddbMock
      .on(GetCommand, { Key: houseKey("winner-house-id") })
      .resolves({ Item: { id: "winner-house-id", neighborhoodId: "n1" } });

    const result = (await handler(makeEvent(REQUEST_BODY))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.created).toBe(false);
    expect(body.house.id).toBe("winner-house-id");
  });
});
