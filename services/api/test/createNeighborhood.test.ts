import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { PutCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/createNeighborhood.js";
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

function makeEvent(body: unknown, userId = "organizer-1"): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    requestContext: userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

function existingNeighborhood(overrides: Partial<Neighborhood> = {}): Neighborhood {
  return {
    id: "existing-1",
    name: "Old Towne",
    normalizedName: "old towne",
    polygon: square(-122.42, 37.77, -122.40, 37.79),
    bbox: { minLon: -122.42, minLat: 37.77, maxLon: -122.40, maxLat: 37.79 },
    centroid: { lat: 37.78, lon: -122.41 },
    status: "active",
    organizerIds: ["other-organizer"],
    createdBy: "other-organizer",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
  ddbMock.on(PutCommand).resolves({}); // spatial lock acquisition succeeds by default
  ddbMock.on(ScanCommand).resolves({ Items: [] }); // no existing neighborhoods by default
  ddbMock.on(TransactWriteCommand).resolves({});
});

describe("createNeighborhood handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(
      makeEvent({ name: "Maple Hollow", polygon: square(0, 0, 1, 1) }, ""),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("returns 422 for a self-intersecting polygon", async () => {
    const bowtie = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
    };
    const result = (await handler(makeEvent({ name: "Bad Shape", polygon: bowtie }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(422);
  });

  it("creates the neighborhood active and an organizer membership when there's no overlap", async () => {
    const result = (await handler(
      makeEvent({ name: "Maple Hollow", polygon: square(-100.42, 37.77, -100.40, 37.79) }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body.organizerIds).toEqual(["organizer-1"]);
    expect(body.status).toBe("active");

    const transactCall = ddbMock.commandCalls(TransactWriteCommand)[0]!;
    const items = transactCall.args[0].input.TransactItems!;
    expect(items).toHaveLength(2);
    expect(items[1]!.Put!.Item).toMatchObject({ role: "organizer", state: "active", userId: "organizer-1" });
  });

  it("blocks creation with 409 when overlap with an existing neighborhood is >= 0.8", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [existingNeighborhood()] });
    // Nearly identical polygon to the existing one -> heavy overlap.
    const result = (await handler(
      makeEvent({ name: "Old Towne Copy", polygon: square(-122.4199, 37.7701, -122.4001, 37.7899) }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(409);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("creates as pending_review (not active) when overlap is partial", async () => {
    const existing = existingNeighborhood({
      polygon: square(-122.42, 37.77, -122.40, 37.79),
      bbox: { minLon: -122.42, minLat: 37.77, maxLon: -122.40, maxLat: 37.79 },
    });
    ddbMock.on(ScanCommand).resolves({ Items: [existing] });
    // Shifted by half a side length -> partial (~25%) overlap, not containment or near-identity.
    const result = (await handler(
      makeEvent({ name: "Partial Overlap", polygon: square(-122.41, 37.78, -122.39, 37.80) }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body.status).toBe("pending_review");
  });

  it("returns 409 when the spatial lock can't be acquired even after a retry", async () => {
    const lockError = new Error("Conditional check failed");
    lockError.name = "ConditionalCheckFailedException";
    ddbMock.on(PutCommand).rejects(lockError);

    const result = (await handler(
      makeEvent({ name: "Maple Hollow", polygon: square(-100.42, 37.77, -100.40, 37.79) }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(409);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});
