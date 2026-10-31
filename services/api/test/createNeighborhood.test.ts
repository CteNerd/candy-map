import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/createNeighborhood.js";

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

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
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

  it("creates the neighborhood and an organizer membership for the creator", async () => {
    const result = (await handler(
      makeEvent({ name: "Maple Hollow", polygon: square(-122.42, 37.77, -122.41, 37.78) }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body.organizerIds).toEqual(["organizer-1"]);
    expect(body.createdBy).toBe("organizer-1");
    expect(body.status).toBe("active");

    const transactCall = ddbMock.commandCalls(TransactWriteCommand)[0]!;
    const items = transactCall.args[0].input.TransactItems!;
    expect(items).toHaveLength(2);
    expect(items[1]!.Put!.Item).toMatchObject({ role: "organizer", state: "active", userId: "organizer-1" });
  });
});
