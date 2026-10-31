import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/submitClaim.js";
import { houseKey } from "../src/lib/table.js";
import type { HouseClaim } from "@candy-map/shared";

const ddbMock = mockClient(ddbDocClient);

function makeEvent(body: unknown, userId = "resident-1"): APIGatewayProxyEventV2 {
  return {
    body: body ? JSON.stringify(body) : undefined,
    requestContext: userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: houseKey("house-1") }).resolves({ Item: { id: "house-1" } });
  ddbMock.on(PutCommand).resolves({});
});

describe("submitClaim handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(makeEvent({ houseId: "house-1" }, ""))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("returns 404 when the house does not exist", async () => {
    const result = (await handler(makeEvent({ houseId: "missing-house" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
  });

  it("creates a new pending claim when nobody has claimed the house yet", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const result = (await handler(makeEvent({ houseId: "house-1" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!) as HouseClaim;
    expect(body.status).toBe("pending");
  });

  it("marks a new claimant as disputed rather than overwriting another user's approved claim", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ houseId: "house-1", userId: "other-resident", status: "approved", verificationLevel: "organizer_approved" }],
    });
    const result = (await handler(makeEvent({ houseId: "house-1" }))) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body!) as HouseClaim;
    expect(body.status).toBe("disputed");
  });

  it("is a no-op when the same user resubmits their own already-approved claim", async () => {
    const existing: HouseClaim = {
      houseId: "house-1",
      userId: "resident-1",
      status: "approved",
      verificationLevel: "organizer_approved",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    ddbMock.on(QueryCommand).resolves({ Items: [existing] });
    const result = (await handler(makeEvent({ houseId: "house-1" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!) as HouseClaim;
    expect(body.status).toBe("approved");
    expect(body.updatedAt).toBe(existing.updatedAt);
  });
});
