import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/approveClaim.js";
import { houseClaimKey, houseKey, neighborhoodMembershipKey } from "../src/lib/table.js";

const ddbMock = mockClient(ddbDocClient);

const HOUSE = { id: "house-1", neighborhoodId: "n1" };
const PENDING_CLAIM = {
  houseId: "house-1",
  userId: "resident-1",
  status: "pending",
  verificationLevel: "self_reported",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function makeEvent(claimId: string | undefined, userId = "organizer-1"): APIGatewayProxyEventV2 {
  return {
    pathParameters: claimId ? { id: claimId } : undefined,
    requestContext: userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
  ddbMock.on(GetCommand, { Key: houseKey("house-1") }).resolves({ Item: HOUSE });
  ddbMock.on(GetCommand, { Key: houseClaimKey("house-1", "resident-1") }).resolves({ Item: PENDING_CLAIM });
  ddbMock.on(PutCommand).resolves({});
});

describe("approveClaim handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(makeEvent("house-1::resident-1", ""))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("returns 400 for a malformed claim id", async () => {
    const result = (await handler(makeEvent("not-a-valid-claim-id"))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("returns 403 for a non-organizer", async () => {
    ddbMock.on(GetCommand, { Key: neighborhoodMembershipKey("n1", "not-organizer") }).resolves({ Item: undefined });
    const result = (await handler(
      makeEvent("house-1::resident-1", "not-organizer"),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
  });

  it("approves the claim for an active organizer", async () => {
    ddbMock
      .on(GetCommand, { Key: neighborhoodMembershipKey("n1", "organizer-1") })
      .resolves({ Item: { neighborhoodId: "n1", userId: "organizer-1", role: "organizer", state: "active" } });

    const result = (await handler(makeEvent("house-1::resident-1"))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.status).toBe("approved");
    expect(body.verificationLevel).toBe("organizer_approved");
  });
});
