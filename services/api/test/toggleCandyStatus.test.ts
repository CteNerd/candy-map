import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/toggleCandyStatus.js";
import { houseClaimKey, houseKey, neighborhoodMembershipKey } from "../src/lib/table.js";

const ddbMock = mockClient(ddbDocClient);

const HOUSE = { id: "house-1", neighborhoodId: "n1" };

function makeEvent(body: unknown, userId = "resident-1"): APIGatewayProxyEventV2 {
  return {
    pathParameters: { id: "house-1" },
    body: body ? JSON.stringify(body) : undefined,
    requestContext: userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
  ddbMock.on(GetCommand, { Key: houseKey("house-1") }).resolves({ Item: HOUSE });
  ddbMock.on(PutCommand).resolves({});
});

describe("toggleCandyStatus handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(makeEvent({ status: "available" }, ""))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("returns 400 for an invalid status value", async () => {
    const result = (await handler(makeEvent({ status: "sold-out" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("returns 403 for a user with no approved claim and no organizer membership", async () => {
    ddbMock.on(GetCommand, { Key: houseClaimKey("house-1", "resident-1") }).resolves({ Item: undefined });
    ddbMock.on(GetCommand, { Key: neighborhoodMembershipKey("n1", "resident-1") }).resolves({ Item: undefined });

    const result = (await handler(makeEvent({ status: "low" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });

  it("allows the approved claimant to update status", async () => {
    ddbMock
      .on(GetCommand, { Key: houseClaimKey("house-1", "resident-1") })
      .resolves({ Item: { houseId: "house-1", userId: "resident-1", status: "approved" } });
    ddbMock.on(GetCommand, { Key: neighborhoodMembershipKey("n1", "resident-1") }).resolves({ Item: undefined });

    const result = (await handler(makeEvent({ status: "available" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.status).toBe("available");
  });

  it("allows an organizer to update status even without a claim", async () => {
    ddbMock.on(GetCommand, { Key: houseClaimKey("house-1", "organizer-1") }).resolves({ Item: undefined });
    ddbMock
      .on(GetCommand, { Key: neighborhoodMembershipKey("n1", "organizer-1") })
      .resolves({ Item: { neighborhoodId: "n1", userId: "organizer-1", role: "organizer", state: "active" } });

    const result = (await handler(makeEvent({ status: "finished" }, "organizer-1"))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});
