import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getCurrentSeasonId, houseParticipationKey } from "../src/lib/table.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/getMyClaims.js";

const ddbMock = mockClient(ddbDocClient);

function makeEvent(userId = "resident-1"): APIGatewayProxyEventV2 {
  return {
    requestContext: userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({});
  process.env.TABLE_NAME = "test-table";
});

describe("getMyClaims handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(makeEvent(""))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("queries gsi1 scoped to the caller's own user id and returns the claims", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ houseId: "house-1", userId: "resident-1", status: "pending" }] });

    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body).toHaveLength(1);
    expect(body[0].houseId).toBe("house-1");
    expect(body[0].participation).toBeNull();

    const call = ddbMock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ":user": "USER#resident-1" });
  });

  it("restores saved finished/expired participation scoped to the caller's houses", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ houseId: "house-1", userId: "resident-1", status: "approved" }] });
    const participation = {
      houseId: "house-1", seasonId: getCurrentSeasonId(), status: "finished",
      updatedAt: "2026-10-31T20:00:00.000Z", expiresAt: "2026-10-31T20:00:00.000Z", publicOptIn: true,
    };
    ddbMock.on(GetCommand).resolves({ Item: { ...participation, pk: "HOUSE#house-1", sk: "PARTICIPATION#season" } });
    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;
    expect(JSON.parse(result.body!)[0].participation).toEqual(participation);
    expect(ddbMock.commandCalls(GetCommand)[0]!.args[0].input).toEqual({
      TableName: "test-table", Key: houseParticipationKey("house-1", getCurrentSeasonId()), ConsistentRead: true,
    });
  });

  it("does not read participation when the user has no claims", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;
    expect(JSON.parse(result.body!)).toEqual([]);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it("propagates participation read failures rather than returning an unsaved status", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ houseId: "house-1", userId: "resident-1", status: "approved" }] });
    ddbMock.on(GetCommand).rejects(new Error("Database unavailable"));
    await expect(handler(makeEvent())).rejects.toThrow("Database unavailable");
  });
});
